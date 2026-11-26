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
  correction?: string;
  /** A drawn sequence, not a screen. The page says which, and the frame carries the word DIAGRAM. */
  diagram?: boolean;
};

type Story = {
  title: string;
  premise: string;
  frames: Frame[];
};

/**
 * Six stories, not one walkthrough.
 *
 * A single linear path answers "what happens when it works", which is the least interesting question about a spending
 * instrument. The stories are ordered by what a reader has to believe next: that it works unattended (2), that it can
 * be changed (3), that it can be stopped (4), and only then what happens when something goes wrong (6).
 *
 * Frames marked `diagram` are drawn sequences, not screenshots — the word DIAGRAM is on the frame, because a diagram
 * that pretends to be a screen is how a storyboard starts lying.
 */
const STORIES: Story[] = [
  {
    title: "1 · Set up a teammate",
    premise: "The human asks for a job; the agent asks for a cap.",
    frames: [
      {
        src: "/mocks/frame-setup.png",
        alt: "A setup screen offering four job presets — Research, Errands, Build, Custom — with the numbers already filled in.",
        title: "Pick a job, not a limit",
        caption:
          "A blank form is homework. The presets are jobs, not amounts, and picking one fills the numbers in — every one stays editable, and Custom… is the blank form for anyone who wants it.",
        correction:
          "A proposal, not a shipped screen. Nothing in this repository renders this yet; the copy and the argument are settled and the screen is the cheap part.",
      },
      {
        src: "/mocks/frame-face-id.png",
        alt: "Three states of the iOS Face ID prompt: our pre-prompt, the system sheet, and the result.",
        title: "One biometric prompt",
        caption:
          "Our pre-prompt explains what is being granted; the system sheet is iOS's and we cannot restyle it; the result returns to our page.",
        correction:
          "We choose when the prompt appears, never how it looks. A mock that draws its own Face ID sheet is drawing something we will never ship.",
      },
      {
        src: "/mocks/frame-pass-active.png",
        alt: "A wallet pass in deep indigo with the teammate name, a per-purchase and per-day limit, an expiry and a seal.",
        title: "The pass arrives",
        caption:
          "It looks like a card in the wallet and it cannot tap to pay. No chip, no number, no network mark: a document with a limit on it.",
      },
    ],
  },
  {
    title: "2 · The teammate works",
    premise: "Forty payments happen and the human sees none of them.",
    frames: [
      {
        src: "/mocks/story2-calls.png",
        alt: "A list of payments with times, payees, amounts and verdicts, headed 40 payments today and notifications sent: 0.",
        title: "The work nobody watches",
        caption:
          "This list is the whole user-visible surface of an agent spending money. The human sees it when they go looking, which is the design and not an outage.",
        correction:
          "Every value here is a fixture. No endpoint produced this table, and the page would rather say so than let a screenshot imply a workload that does not exist yet.",
      },
      {
        src: "/mocks/story2-refusal.png",
        alt: "A do_not_pay verdict naming the per-payment cap, the payee, and that no signature was produced.",
        title: "A refusal at the cap",
        caption:
          "The agent receives the rule that fired and the numbers, then stops. A refusal that says only \"outside policy\" is a support ticket, not an answer.",
      },
      {
        src: "/mocks/story2-review.png",
        alt: "A review verdict carrying the amount, its share of the allowance, the checks run and the checks skipped.",
        title: "A review arriving",
        caption:
          "The middle verdict: not a yes, not a no. It carries what was checked and — the part nobody else prints — what was not, including whether the seller delivers.",
      },
    ],
  },
  {
    title: "3 · The human adjusts",
    premise: "The limit is too low. The agent asks; the human taps.",
    frames: [
      {
        src: "/mocks/frame-mandate-page.png",
        alt: "The mandate page: the same tint, mark and teammate name as the pass, with the limits and an action.",
        title: "The page is the editor",
        caption:
          "Same tint, same mark, same name as the pass in the wallet — the page is the pass with controls on it. The agent drafts every change; the human is the only one who can approve one.",
      },
      {
        src: "/mocks/frame-pass-changed.png",
        alt: "The same pass after a change, with the new limits on the face.",
        title: "The pass updates",
        caption: "One tap, and the wallet pass shows the new numbers. There is no second card to keep in sync.",
      },
    ],
  },
  {
    title: "4 · The human stops",
    premise: "One action, and the name comes off.",
    frames: [
      {
        src: "/mocks/story4-revoke.png",
        alt: "A page with one primary action: Stop this pass.",
        title: "One action",
        caption:
          "Revocation is a signed statement, not an edit: the pass is immutable, so stopping it is a second object that names the serial. A revocation that needs re-signing is one that gets lost in a queue.",
      },
      {
        src: "/mocks/frame-pass-revoked.png",
        alt: "The same pass in grey with a REVOKED state, all colour removed.",
        title: "The face says so",
        caption: "The pass keeps its place in the wallet and loses its colour and its claim. Nothing is deleted, so nothing can be quietly restored.",
      },
      {
        src: "/mocks/story4-deleted.png",
        alt: "A diagram comparing removing the pass from the wallet with revoking it.",
        title: "Deleting the pass is not revoking it",
        caption:
          "The misunderstanding worth a frame: removing the image from a phone changes nothing on the server. Only revocation changes what the endpoint says to a stranger.",
        diagram: true,
      },
    ],
  },
  {
    title: "5 · A stranger checks",
    premise: "Someone has never heard of us and wants one answer.",
    frames: [
      {
        src: "/mocks/frame-stack.png",
        alt: "Four passes fanned like cards, each a different tint with its own teammate name and cap.",
        title: "Four teammates, one principal",
        caption: "Each teammate gets its own cap and its own tint, and revoking one leaves the others alone.",
        correction:
          "The caps are set by hand, one at a time. The agent may draft a change, but it cannot add a teammate or raise a cap.",
      },
      {
        title: "The scan page — not built",
        caption:
          "A stranger scans the QR and lands on one page with one answer: active, revoked, expired or unknown. Until the mandate store exists, every serial answers unknown, and drawing the page would be the theatre this project keeps arguing against.",
        correction:
          "Placeholder on purpose, and correct until #436 lands. The frame appears here as an empty slot rather than a picture.",
      },
    ],
  },
  {
    title: "6 · Something goes wrong",
    premise: "The cases nobody puts in a demo.",
    frames: [
      {
        src: "/mocks/story6-failclosed.png",
        alt: "A three-step diagram: the agent asks for a verdict, the adapter refuses, no signature is produced.",
        title: "Our service is down",
        caption:
          "Fail closed, by design: an unreachable gate is not an approval. The alternative turns every outage into an unguarded spending window.",
        diagram: true,
      },
      {
        src: "/mocks/story6-cancelled.png",
        alt: "A diagram: the biometric prompt is cancelled, so no mandate exists to spend.",
        title: "Face ID cancelled",
        caption: "Nothing is issued, so there is nothing to spend and nothing to revoke. The agent learns why and stops.",
        diagram: true,
      },
      {
        src: "/mocks/story6-stale.png",
        alt: "A diagram comparing a screenshot that says active with a live endpoint that answers revoked.",
        title: "A stale image, a live answer",
        caption:
          "The QR is the authority, not the picture. An old image is a claim about the past — which is also why a pass cannot be verified offline.",
        diagram: true,
      },
      {
        src: "/mocks/story6-unknown.png",
        alt: "An unknown serial answered with 200 and a body saying we hold no record of it.",
        title: "An unknown serial",
        caption:
          "Unknown is a fact about the record, not a missing page — so the answer is 200 with a body that says so, and never a 404 a client would read as a transient error.",
      },
      {
        src: "/mocks/story6-429.png",
        alt: "A 429 body saying the free tier is exhausted, that the service is working, and where the paid path is.",
        title: "The free allowance runs out",
        caption:
          "A caller must be able to tell \"capped\" from \"broken\". The body names the cap, says the service is working, and gives the reset.",
      },
      {
        src: "/mocks/story6-capmid.png",
        alt: "A diagram of two bars: the allowance before a job and after twelve calls, with the thirteenth refused.",
        title: "The cap arrives mid-job",
        caption:
          "The boring, common failure: the thirteenth call of a batch is refused and the task fails. The agent's task failing is correct; the human's money not moving is the point.",
        diagram: true,
      },
    ],
  },
];

export default function MocksPage() {
  return (
    <main className="lp-wrap lp-prose">
      <h1>Mocks</h1>
      <p className="lp-lead">
        The Vouch model, in six stories. Every image below is rendered by <code>scripts/lib/pass-face.mjs</code> and{" "}
        <code>scripts/lib/pass-story.mjs</code> — the same layout functions that produce the Wallet assets — so nothing
        here is a separate drawing that can drift from what ships.
      </p>
      <p>It looks like a card in the wallet, and it cannot tap to pay.</p>
      <p style={{ color: "#5B6472" }}>
        Frames marked <strong>DIAGRAM</strong> are drawn sequences, not screenshots: they explain a state machine that
        nobody could photograph. Every number in every frame is a fixture, and nothing on this page is served by an
        endpoint.
      </p>

      {STORIES.map((story) => (
        <section key={story.title} style={{ margin: "3.5rem 0 0" }}>
          <h2 style={{ marginBottom: "0.25rem" }}>{story.title}</h2>
          <p style={{ color: "#3C4350", fontStyle: "italic", marginTop: 0 }}>{story.premise}</p>

          {story.frames.map((frame) => (
            <section key={frame.title} style={{ margin: "2rem 0" }}>
              <h3>{frame.title}</h3>
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
        </section>
      ))}
    </main>
  );
}
