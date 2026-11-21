/**
 * Read-side model for the minimal `/wallets` page (#310).
 *
 * The page renders the hosted `GET /wallets/<address>` document, not a local classification. That keeps one
 * classifier in the repository and means this page cannot disagree with the API about what was observed.
 *
 * The distinction this file protects is the one the item is about: **no observations** and **could not
 * read** are different results. An empty document renders the exact sentence the item requires; a failed
 * fetch renders why it failed and never the empty sentence.
 */

export const EMPTY_MESSAGE = "no observations recorded for this address";

export interface WalletProvenance {
  source: string;
  observed_at: string;
}

export interface WalletObservation extends WalletProvenance {
  field: string;
  value: unknown;
}

export interface WalletLabel {
  field: string;
  value: unknown;
  provenance: WalletProvenance[];
}

export interface WalletDisagreement {
  field: string;
  values: Array<WalletProvenance & { value: unknown }>;
}

export interface WalletCategories {
  schema: string;
  address: string;
  labels: WalletLabel[];
  observations: WalletObservation[];
  disagreements: WalletDisagreement[];
}

export type WalletView =
  | { kind: "idle" }
  | { kind: "empty"; address: string }
  | { kind: "ready"; categories: WalletCategories }
  | { kind: "unavailable"; address: string; reason: string };

export const EVM_ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isProvenance(value: unknown): value is WalletProvenance {
  return (
    isRecord(value) &&
    typeof value.source === "string" &&
    value.source.trim() !== "" &&
    typeof value.observed_at === "string" &&
    value.observed_at.trim() !== ""
  );
}

/**
 * Validate the fields the page actually renders. Unknown extra fields are ignored (a later API addition
 * must not blank the page), but a label without provenance is refused: an unlabelled fact is the thing
 * this item forbids.
 */
export function parseWalletCategories(raw: unknown): WalletCategories | null {
  if (!isRecord(raw)) return null;
  if (typeof raw.schema !== "string" || typeof raw.address !== "string") return null;
  if (!Array.isArray(raw.labels) || !Array.isArray(raw.observations) || !Array.isArray(raw.disagreements)) {
    return null;
  }

  const observations: WalletObservation[] = [];
  for (const entry of raw.observations) {
    if (!isRecord(entry) || !("value" in entry)) return null;
    if (typeof entry.field !== "string" || entry.field.trim() === "") return null;
    if (!isProvenance(entry)) return null;
    observations.push({
      source: entry.source,
      observed_at: entry.observed_at,
      field: entry.field,
      value: entry.value,
    });
  }

  const labels: WalletLabel[] = [];
  for (const entry of raw.labels) {
    if (!isRecord(entry) || typeof entry.field !== "string" || !("value" in entry)) return null;
    if (!Array.isArray(entry.provenance) || entry.provenance.length === 0) return null;
    if (!entry.provenance.every(isProvenance)) return null;
    labels.push({
      field: entry.field,
      value: entry.value,
      provenance: entry.provenance.map((p) => ({ source: p.source, observed_at: p.observed_at })),
    });
  }

  const disagreements: WalletDisagreement[] = [];
  for (const entry of raw.disagreements) {
    if (!isRecord(entry) || typeof entry.field !== "string") return null;
    if (!Array.isArray(entry.values) || entry.values.length < 2) return null;
    if (!entry.values.every((v) => isProvenance(v) && "value" in v)) return null;
    disagreements.push({
      field: entry.field,
      values: entry.values.map((v) => ({
        value: (v as { value: unknown }).value,
        source: v.source,
        observed_at: v.observed_at,
      })),
    });
  }

  return {
    schema: raw.schema,
    address: raw.address,
    labels,
    observations,
    disagreements,
  };
}

/** Turn a parsed-or-raw API document into the page's view state. */
export function viewFromPayload(raw: unknown, address: string): WalletView {
  const categories = parseWalletCategories(raw);
  if (categories === null) {
    return { kind: "unavailable", address, reason: "the hosted API did not return a payee-category document" };
  }

  if (categories.observations.length === 0) {
    // Labels or disagreements without observations would be provenance-free facts. Refuse to render the
    // empty sentence over that; the honest answer is that the document is inconsistent.
    if (categories.labels.length > 0 || categories.disagreements.length > 0) {
      return {
        kind: "unavailable",
        address,
        reason: "the hosted API returned labels without observations",
      };
    }
    return { kind: "empty", address };
  }

  return { kind: "ready", categories };
}

export interface LoadWalletOptions {
  fetchImpl?: typeof fetch;
  apiBase?: string;
}

const DEFAULT_API = "https://api.paystage.xyz";

/** Fetch one address from the hosted API and classify the result for rendering. */
export async function loadWalletView(
  address: string,
  options: LoadWalletOptions = {},
): Promise<WalletView> {
  const trimmed = address.trim();
  if (!EVM_ADDRESS_RE.test(trimmed)) {
    return { kind: "unavailable", address: trimmed, reason: "that is not an EVM address" };
  }

  const base = (options.apiBase ?? process.env.PAYSTAGE_API_URL ?? DEFAULT_API).replace(/\/+$/, "");
  const doFetch = options.fetchImpl ?? fetch;

  let res: Response;
  try {
    res = await doFetch(`${base}/wallets/${trimmed.toLowerCase()}`, {
      cache: "no-store",
      headers: { accept: "application/json" },
    });
  } catch {
    return { kind: "unavailable", address: trimmed, reason: "the hosted API could not be reached" };
  }

  if (!res.ok) {
    return {
      kind: "unavailable",
      address: trimmed,
      reason: `the hosted API answered HTTP ${res.status}`,
    };
  }

  let payload: unknown;
  try {
    payload = await res.json();
  } catch {
    return { kind: "unavailable", address: trimmed, reason: "the hosted API returned invalid JSON" };
  }

  return viewFromPayload(payload, trimmed);
}
