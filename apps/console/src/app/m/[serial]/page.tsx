import type { Metadata, Viewport } from "next";
import "../../landing.css";
import "./mandate.css";
import { MandateCard } from "@/components/MandateCard";
import { MANDATE_SERIAL_RE, fetchMandate, mandateApiBase } from "@/lib/mandate";
import { DEFAULT_TINT } from "@/lib/pass-tokens";

/**
 * `/m/:serial` — the HTML page the QR points at (#436).
 *
 * The QR must open this page, not `GET /v1/mandate/:serial`: a camera app that lands on raw JSON is the
 * most common way a verification feature looks broken. The JSON stays for machines, and this page links
 * it from the card.
 *
 * Three things are load-bearing here:
 *
 *  1. **No caching.** A cached `active` would outlive a revocation. `force-dynamic` + a `no-store` fetch
 *     keep the answer live; a CDN cache rule for `/m/*` would be a safety incident.
 *  2. **`unknown` is an ordinary answer.** A serial the store has never seen answers `unknown`, and the
 *     page shows that in the same visual language as `revoked`; it never turns it into an error, and a
 *     failed read is never shown as `unknown` (that would say "no such mandate" when the truth is
 *     "could not check").
 *  3. **A camera must never see a framework error page.** A malformed serial renders a plain 200
 *     explanation before any fetch happens.
 *
 * Only the fields in the endpoint's body are rendered. The write half is deliberately absent: a change
 * requires a signature from the account holding the authority, which the endpoint does not yet accept,
 * so the page says that once and offers no control that cannot work.
 *
 * #440: the page is the pass, structurally. Its colours, type sizes and pad ratio come from
 * `apps/console/src/lib/pass-tokens.json` — the same file `scripts/lib/pass-face.mjs` renders the Wallet
 * assets from — and `MandateCard` draws the pass's own poster head. The browser chrome takes the tint
 * too, and the page has no dark mode because a pass does not have one.
 */
export const metadata: Metadata = {
  title: "Mandate",
  description: "The record behind a Vouch pass: its status, caps, expiry and when it was read.",
  robots: { index: false, follow: false },
};

/**
 * The page margin is the stylesheet's; this export carries the other two numbers from #440: `theme-color`
 * is the pass tint, and `colorScheme: "light"` says out loud that the page does not invert. A second fetch
 * to make the tint per-mandate is exactly what this page must not add, so the tint is the token default —
 * the tint of a pass with no teammate name, which is all the endpoint returns today.
 */
export const viewport: Viewport = {
  themeColor: DEFAULT_TINT,
  colorScheme: "light",
};

/** The one endpoint where a cached HTML 200 is a safety incident. */
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

type PageProps = { params: Promise<{ serial: string }> };

export default async function MandatePage({ params }: PageProps) {
  const { serial } = await params;

  // Check the shape before the fetch. An invalid serial is a person typing or a damaged link, not a
  // record to look up, and the endpoint would answer 400 — a framework error to a camera.
  if (!MANDATE_SERIAL_RE.test(serial)) {
    return <MandateCard state={{ kind: "malformed", serial }} />;
  }

  const state = await fetchMandate(serial, { apiBase: mandateApiBase() });
  return <MandateCard state={state} />;
}
