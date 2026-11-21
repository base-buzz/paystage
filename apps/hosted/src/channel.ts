/**
 * Channel attribution (#326) — a listing says which directory sent a caller with `?from=<channel>`.
 *
 * The only signal is the query parameter. No IP, no user agent, no referrer URL is read here; the request URL and the
 * first-party session cookie below are the whole input.
 *
 * Normalisation rules, deliberately narrow:
 *   * lowercase;
 *   * only `[a-z0-9._-]`;
 *   * 1–32 characters after lowercasing;
 *   * anything else is `null`.
 *
 * `null` means "unknown", never "direct": bucketing unknown into direct is what makes a distribution map
 * unfalsifiable, which is the reason this item exists.
 */
import type { Context, MiddlewareHandler } from "hono";
import { getCookie, setCookie } from "hono/cookie";

export const CHANNEL_PARAM = "from";
export const CHANNEL_COOKIE = "paystage_channel";
export const CHANNEL_MAX_LENGTH = 32;

const CHANNEL_RE = /^[a-z0-9._-]{1,32}$/;

/**
 * `"Glama"` → `"glama"`; `"glama!"` → `null`; `"a".repeat(33)` → `null`.
 *
 * No trimming: a value with a space is not a channel a publisher controls, and silently repairing it would make
 * two spellings of one channel. The publisher can send the exact token.
 */
export function normaliseChannel(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const lower = raw.toLowerCase();
  return CHANNEL_RE.test(lower) ? lower : null;
}

/** Read and normalise `?from=` from a request URL. Unparseable URLs and absent/invalid params are `null`. */
export function channelFromUrl(input: string | URL): string | null {
  let url: URL;
  try {
    url = input instanceof URL ? input : new URL(input, "https://paystage.invalid");
  } catch {
    return null;
  }
  return normaliseChannel(url.searchParams.get(CHANNEL_PARAM));
}

/**
 * First valid touch wins for a session.
 *
 * A known previous channel is kept even when this request carries a different one. An absent or invalid previous
 * value is not a touch, so the first valid `?from=` can still set the session; `null` is never treated as a channel.
 */
export function firstTouch(
  previous: string | null | undefined,
  incoming: string | null | undefined,
): string | null {
  return normaliseChannel(previous) ?? normaliseChannel(incoming);
}

/** Read the channel cookie from a raw Cookie header (used by the MCP handler, which has a Request, not a Context). */
export function channelFromCookieHeader(header: string | null | undefined): string | null {
  if (typeof header !== "string" || header.length === 0) return null;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() !== CHANNEL_COOKIE) continue;
    try {
      return normaliseChannel(decodeURIComponent(part.slice(eq + 1).trim()));
    } catch {
      return null;
    }
  }
  return null;
}

type ChannelVars = { Variables: { channel: string | null } };

/**
 * Resolve the channel once per request, expose it as `c.get("channel")`, and remember the first touch in a session
 * cookie.
 *
 * The cookie carries only the channel token — no identifier, no expiry (a session cookie) — which is why it can answer
 * "first touch wins for a session" without a tracker. A client that does not keep cookies still gets the channel on
 * the first request; later requests from that client are unknown, which the panel reports as its own row.
 */
export function channelMiddleware(): MiddlewareHandler<ChannelVars> {
  return async (c, next) => {
    const previous = normaliseChannel(getCookie(c, CHANNEL_COOKIE));
    const channel = firstTouch(previous, channelFromUrl(c.req.url));
    c.set("channel", channel);

    await next();

    if (channel !== null && channel !== previous) {
      const secure = (() => {
        try {
          return new URL(c.req.url).protocol === "https:";
        } catch {
          return true;
        }
      })();
      setCookie(c, CHANNEL_COOKIE, channel, {
        httpOnly: true,
        sameSite: "Lax",
        secure,
        path: "/",
      });
    }
  };
}

/** Test seam: the context variable name, so a route cannot read a different one. */
export const CHANNEL_VAR = "channel" as const;
export type ChannelContext = Context<ChannelVars>;
