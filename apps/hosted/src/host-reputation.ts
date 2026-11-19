/**
 * How old is the seller's domain, and when did it first get a certificate?
 *
 * The payee registry (#133) can only speak about hosts we have probed. For everything else the honest answer today is "we don't
 * know" — and silence is indistinguishable from a clean bill of health to a caller. These two free sources give a *fact* where
 * we would otherwise have nothing: a domain registered last week and a certificate issued yesterday describe a host that has no
 * history to lose, which is the shape of a clone.
 *
 * Rules, same as the address-risk feed:
 *  - hosted only, because the local evaluator must work offline;
 *  - fail soft but never silently: a failure returns `error` and the caller keeps the verdict it had, rather than inventing a
 *    clean record or a refusal;
 *  - cached, because RDAP and crt.sh are somebody else's servers and a payment loop must not hammer them.
 */

export type HostReputation = {
  host: string;
  /** ISO date the domain was registered, from RDAP. */
  registered_at: string | null;
  /** Whole days between registration and now. */
  domain_age_days: number | null;
  /** ISO date of the earliest certificate crt.sh knows about. */
  first_certificate_at: string | null;
  cached: boolean;
  /** Set when a source could not be read; callers must not read that as "clean". */
  error?: string;
};

const CACHE = new Map<string, { at: number; value: HostReputation }>();
const TTL_MS = 6 * 60 * 60_000; // domain age moves by a day, at most
const TIMEOUT_MS = 4_000;

export function clearHostReputationCache(): void {
  CACHE.clear();
}

const days = (from: number, to: number) => Math.max(0, Math.floor((to - from) / 86_400_000));

/** Registrable domain: the last two labels, which is enough for RDAP and for crt.sh's wildcard-free query. */
export function baseDomain(host: string): string | null {
  const clean = host.toLowerCase().replace(/^\.+/, "");
  if (!/^[a-z0-9.-]+$/.test(clean)) return null;
  const parts = clean.split(".").filter(Boolean);
  if (parts.length < 2) return null;
  const [tld, sld] = [parts.at(-1) as string, parts.at(-2) as string];
  // Handle a few common two-part suffixes so co.uk does not become "co.uk".
  const twoPart = ["co", "com", "net", "org", "gov", "ac"];
  const base = twoPart.includes(sld) && parts.length >= 3 ? parts.slice(-3).join(".") : `${sld}.${tld}`;
  return base;
}

/** IANA's bootstrap file, cached for a day: where each TLD's RDAP server lives. */
let BOOTSTRAP: { at: number; map: Map<string, string> } | null = null;

async function rdapBaseFor(domain: string, doFetch: typeof fetch): Promise<string | null> {
  const tld = domain.split(".").at(-1)?.toLowerCase() ?? "";
  if (BOOTSTRAP && Date.now() - BOOTSTRAP.at < 86_400_000) return BOOTSTRAP.map.get(tld) ?? null;
  try {
    const res = await doFetch("https://data.iana.org/rdap/dns.json", {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { "user-agent": "PayStage-host-reputation/1.0" },
    });
    if (!res.ok) throw new Error(`bootstrap HTTP ${res.status}`);
    const doc = (await res.json()) as { services?: Array<[string[], string[]]> };
    const map = new Map<string, string>();
    for (const [tlds, urls] of doc.services ?? []) {
      for (const t of tlds) if (urls[0]) map.set(t.toLowerCase(), urls[0]);
    }
    BOOTSTRAP = { at: Date.now(), map };
    return map.get(tld) ?? null;
  } catch {
    return null;
  }
}

export async function checkHostReputation(
  host: string,
  options: { fetchImpl?: typeof fetch; now?: number } = {},
): Promise<HostReputation> {
  const now = options.now ?? Date.now();
  const domain = baseDomain(host);
  if (!domain) {
    return { host, registered_at: null, domain_age_days: null, first_certificate_at: null, cached: false, error: "not a domain name" };
  }

  const hit = CACHE.get(domain);
  if (hit && now - hit.at < TTL_MS) return { ...hit.value, cached: true };

  const doFetch = options.fetchImpl ?? fetch;
  const value: HostReputation = {
    host: domain,
    registered_at: null,
    domain_age_days: null,
    first_certificate_at: null,
    cached: false,
  };

  /**
   * Ask the TLD's own RDAP server, not an aggregator.
   *
   * `rdap.org` answers **403** to this Worker — verified live 2026-11-19, and it was silent because the failure was fail-soft. The
   * IANA bootstrap publishes where each TLD actually lives, so the query goes to `rdap.centralnic.com` for `.xyz` and
   * `rdap.verisign.com` for `.com` — both answer 200 from the same environment.
   */
  try {
    const base = await rdapBaseFor(domain, doFetch);
    if (!base) throw new Error("no RDAP server published for this TLD");
    const res = await doFetch(`${base.replace(/\/$/, "")}/domain/${domain}`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { accept: "application/rdap+json", "user-agent": "PayStage-host-reputation/1.0" },
    });
    if (!res.ok) throw new Error(`RDAP HTTP ${res.status}`);
    const doc = (await res.json()) as { events?: Array<{ eventAction?: string; eventDate?: string }> };
    const registered = (doc.events ?? []).find((e) => e.eventAction === "registration")?.eventDate ?? null;
    if (registered) {
      value.registered_at = registered;
      value.domain_age_days = days(Date.parse(registered), now);
    }
  } catch (error) {
    value.error = `RDAP: ${String(error).slice(0, 80)}`;
  }

  try {
    const res = await doFetch(`https://crt.sh/?q=${encodeURIComponent(domain)}&output=json&exclude=expired`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { "user-agent": "PayStage-host-reputation/1.0" },
    });
    if (!res.ok) throw new Error(`crt.sh HTTP ${res.status}`);
    const rows = (await res.json()) as Array<{ not_before?: string }>;
    const earliest = rows.map((r) => r.not_before).filter(Boolean).sort()[0] ?? null;
    if (earliest) value.first_certificate_at = new Date(earliest).toISOString();
  } catch (error) {
    value.error = value.error ? `${value.error}; crt.sh failed` : `crt.sh: ${String(error).slice(0, 80)}`;
  }

  // Only cache a complete answer: a partial record cached for six hours would keep saying "unknown" long after the source came back.
  if (!value.error) {
    if (CACHE.size >= 500) CACHE.delete(CACHE.keys().next().value as string);
    CACHE.set(domain, { at: now, value });
  }
  return value;
}

/** A domain younger than this has no history to lose; the caller turns that into `review`, not a refusal. */
export const YOUNG_DOMAIN_DAYS = 30;

/**
 * The youngest signal we could actually read, and what it was.
 *
 * RDAP answers **403** to this Worker on every TLD server we tried (`rdap.org`, `rdap.centralnic.com`) — datacentre egress is
 * blocked, and no amount of retrying changes that. crt.sh answers fine, so the earliest certificate is the signal that works: a
 * host whose first certificate is three months old has a history, whatever its registration date says, and one whose first
 * certificate is a week old does not.
 */
export function youngestSignal(rep: HostReputation): { days: number; source: "domain" | "certificate" } | null {
  const candidates: Array<{ days: number; source: "domain" | "certificate" }> = [];
  if (rep.domain_age_days !== null) candidates.push({ days: rep.domain_age_days, source: "domain" });
  if (rep.first_certificate_at) {
    const certDays = Math.max(0, Math.floor((Date.now() - Date.parse(rep.first_certificate_at)) / 86_400_000));
    candidates.push({ days: certDays, source: "certificate" });
  }
  if (candidates.length === 0) return null;
  return candidates.sort((a, b) => a.days - b.days)[0] ?? null;
}
