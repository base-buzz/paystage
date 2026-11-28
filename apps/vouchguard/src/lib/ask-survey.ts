/**
 * The counted question on the brand site (#511) — the client-safe half.
 *
 * Constants and view transitions live here because the page, the client buttons and the tests all read
 * them. The server half (`ask-server.ts`) holds the route contract, the Supabase call and the IP hash,
 * so nothing in the client bundle mentions a Supabase key.
 */

export const QUESTION = "Would you put a team's agent spend behind a limit you can see?";

export const ASK_ANSWERS = ["yes", "no", "already"] as const;
export type AskAnswer = (typeof ASK_ANSWERS)[number];

export const ASK_OPTIONS: ReadonlyArray<{ value: AskAnswer; label: string }> = [
  { value: "yes", label: "Yes" },
  { value: "no", label: "No" },
  { value: "already", label: "Already do it" },
];

/** The question opened with this page. Kept here so the page can show a date before the first answer. */
export const QUESTION_OPENED = "2026-11-28";

/** Exact sentences the page is required to carry. Tests assert these, not a paraphrase. */
export const NOT_A_LIST = "This is not a customer list. A click is not a payment.";
export const STORAGE_SENTENCE =
  "Your answer is stored as a count, with a hashed IP address to stop repeat votes, and nothing else.";
export const NOT_CONNECTED = "The counter is not connected yet.";

/** The only count the page will show: a JSON number that a read actually returned. */
function positiveInt(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}

export interface AskSnapshot {
  /** True only when ask_count() answered with a numeric count. */
  connected: boolean;
  /** The count read from the database. Null whenever `connected` is false. */
  count: number | null;
  /** ISO date of the first response, or the page's fixed opening date when the table is empty. */
  openedOn: string;
  /** A named failure for the page. Null when the snapshot holds a count. */
  reason: string | null;
}

export interface AskView {
  connected: boolean;
  count: number | null;
  showCount: boolean;
  openedOn: string;
  notice: string | null;
  submitted: boolean;
}

/** The route's JSON contract. `count` appears only when the database returned one. */
export type AskReply =
  | { stored: true; count: number; openedOn: string | null }
  | { stored: false; reason: string; count?: never };

/** Turn a snapshot into the first client view. A count is shown only when the snapshot actually holds one. */
export function initialAskView(snapshot: AskSnapshot): AskView {
  return {
    connected: snapshot.connected,
    count: snapshot.count,
    showCount: snapshot.connected && snapshot.count !== null,
    openedOn: snapshot.openedOn || QUESTION_OPENED,
    notice: snapshot.connected ? null : NOT_CONNECTED,
    submitted: false,
  };
}

/**
 * Apply one route reply to the view.
 *
 * The count is copied from the reply only when `stored === true` and the reply carries an integer. Every
 * other reply keeps the previous view's count (which came from a read) or hides it when the counter itself
 * is missing. This is the page-side half of "never fabricate a count".
 */
export function afterAskReply(view: AskView, reply: unknown): AskView {
  const body = reply as { stored?: unknown; count?: unknown; openedOn?: unknown; reason?: unknown } | null;

  if (body?.stored === true) {
    const count = positiveInt(body.count);
    if (count !== null) {
      return {
        ...view,
        connected: true,
        count,
        showCount: true,
        openedOn: typeof body.openedOn === "string" ? body.openedOn : view.openedOn,
        notice: "Your answer is counted.",
        submitted: true,
      };
    }
    // A stored reply with no readable count cannot extend the count; it does not erase the count a
    // read already supplied, and it does not invent one.
    return {
      ...view,
      notice: "The counter did not return a count.",
      submitted: true,
    };
  }

  const reason =
    typeof body?.reason === "string" && body.reason !== "" ? body.reason : NOT_CONNECTED;
  const missing = /not connected/i.test(reason);

  return {
    ...view,
    connected: missing ? false : view.connected,
    count: missing ? null : view.count,
    showCount: missing ? false : view.showCount,
    notice: missing ? NOT_CONNECTED : reason,
    submitted: true,
  };
}

/** Stable date rendering: no locale lookup, so server and client cannot disagree. */
export function formatOpenedOn(iso: string): string {
  const date = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return iso;
  const months = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];
  return `${date.getUTCDate()} ${months[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

export function countLabel(count: number): string {
  return `${count} response${count === 1 ? "" : "s"}`;
}
