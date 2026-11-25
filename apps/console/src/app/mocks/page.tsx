import type { Metadata } from "next";
import "../landing.css";

/**
 * `/mocks` — the storyboard as a page (#438).
 *
 * The operator is visual, and a page is where the model actually gets checked. Every frame on this page is
 * **rendered from `scripts/lib/pass-face.mjs`**, the same layout function that produces the Wallet assets, so the
 * page cannot show a drawing that disagrees with the product. There is no second set of artwork.
 *
 * Three captions exist because each one is a correction to the slick reference mock this replaced:
 *
 *  1. nothing on the pass face is tappable — the only tap-through is a back-field link;
 *  2. Face ID is an iOS **system** sheet: we choose when it appears, not how it looks;
 *  3. the QR is for someone else's camera — the holder cannot scan their own screen, and for them the path is the
 *     link in the pass's back field.
 *
 * One frame is deliberately **not** an image: the counterparty scan is a page that does not exist yet (`#436`), and
 * drawing it would be the theatre this project keeps arguing against. It says what it will be instead.
 *
 * Unlisted: `robots` says `noindex`, and nothing in the nav links here. The URL is the invitation, same as `/backlog`.
 */
export const metadata: Metadata = {
  title: "Mocks",
  description: "The Vouch model, frame by frame, drawn from the code that ships.",
  robots: { index: false, follow: false, nocache: true },
};

type Frame = {
  src?: string;
  alt?: string;
  title: string;
  caption: string;
  /** Frames that carry one of the three corrections get it called out, not buried in the caption. */
  correction?: string;
};

const FRAMES: Frame[] = [
  {
    title: "1 · The request",
    caption:
      "The agent asks for a cap before it starts. No human is in the loop yet — this is the only step that mentions money before anything is spent.",
  },
  {
    src: "/mocks/frame-face-id.png",
    alt: "A Face ID system sheet asking to approve “this job”.",
    title: "2 · One biometric prompt",
    caption: "One tap. Not a form, not a dashboard, not a queue of approvals to clear.",
    correction:
      "This is an iOS system sheet. We choose when it appears; we do not design how it looks, and we should not pretend otherwise.",
  },
  {
    src: "/mocks/frame-pass-active.png",
    alt: "The pass: limit, window ceiling, expiry, principal, state ACTIVE.",
    title: "3 · The pass arrives",
    caption:
      "The record of what was authorised: the per-payment limit, the window ceiling, who it is for and when it ends. It is a receipt you can hold, not a control panel.",
    correction:
      "Nothing on this face is tappable. The only tap-through is a link in the back fields, because a pass cannot carry a form.",
  },
  {
    src: "/mocks/frame-mandate-page.png",
    alt: "A browser page for one mandate: the limit with a change control, the window ceiling, expiry, payees, refusals, and one button that ends it.",
    title: "4 · The page is the editor",
    caption:
      "The link opens one page for one mandate: change the limit, add or remove a payee, end it early. A list of mandates exists only behind a sign-in, and it is the same object repeated.",
    correction:
      "The token that gets you here can read. Every change requires a signature from the account that holds the authority (#436) — otherwise the agent could raise its own limit by following its own card.",
  },
  {
    src: "/mocks/frame-pass-changed.png",
    alt: "The same pass after a change, now showing a higher limit and window ceiling.",
    title: "5 · The pass updates",
    caption:
      "The same face, a different limit. This is the frame that proves the change is a state, not a screenshot: the plate is data.",
  },
  {
    src: "/mocks/frame-pass-revoked.png",
    alt: "The same pass, revoked: desaturated strip, the limit struck through, a red band, STATE REVOKED.",
    title: "6 · It ends",
    caption:
      "Revoked reads at a glance without a field: desaturated, struck through, red. Delete the pass and nothing changes — the record is on the chain, not in the card.",
  },
  {
    title: "7 · Someone else checks",
    caption:
      "A counterparty scans and reads the record: the serial, whether it is live, what the limit was, and whether to trust it.",
    correction:
      "Not drawn, on purpose. The page this frame shows is #436 and does not exist yet; an illustration of it would be a screenshot of nothing. When it ships, this frame becomes that page.",
  },
];

export default function MocksPage() {
  return (
    <main className="lp-wrap lp-prose">
      <h1>Mocks</h1>
      <p className="lp-lead">
        The Vouch model, frame by frame. Every image below is rendered by <code>scripts/lib/pass-face.mjs</code>, the
        same layout function that produces the Wallet assets — so nothing on this page is a separate drawing that can
        drift from what ships.
      </p>

      {FRAMES.map((frame) => (
        <section key={frame.title} style={{ margin: "2.5rem 0" }}>
          <h2>{frame.title}</h2>
          {frame.src ? (
            // eslint-disable-next-line @next/next/no-img-element -- static assets, no layout shift to optimise
            <img
              src={frame.src}
              alt={frame.alt ?? ""}
              style={{ width: "min(100%, 420px)", height: "auto", border: "1px solid #DDD9CF", borderRadius: 12 }}
            />
          ) : (
            <p
              style={{
                border: "1px dashed #CFC9BC",
                borderRadius: 12,
                padding: "1.25rem",
                maxWidth: 420,
                color: "#5B6472",
              }}
            >
              No image: this frame is a page that has not been built.
            </p>
          )}
          <p>{frame.caption}</p>
          {frame.correction ? (
            <p style={{ borderLeft: "3px solid #1A1F71", paddingLeft: "0.75rem", color: "#3C4350" }}>
              {frame.correction}
            </p>
          ) : null}
        </section>
      ))}

      <p style={{ color: "#5B6472" }}>
        Figures use one fictional principal and one fictional payee set. The brand wordmark is a working name: no
        trademark, domain or app-store check has been run.
      </p>
    </main>
  );
}
