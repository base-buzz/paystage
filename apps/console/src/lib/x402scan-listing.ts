import generated from "./x402scan-listing.generated.json";

/**
 * The x402scan listing, as their index reports it (#484).
 *
 * The operator's instruction was to put this on the landers **once confirmed**. So the page reads a generated snapshot — written by
 * `ops/bin/x402scan-listing-snapshot.mjs` — and renders **nothing at all** while the snapshot says we are not listed. A conditional
 * claim rendered as an empty string is better than a sentence that has to be edited on the day it becomes true, because nobody edits
 * it on that day.
 *
 * What counts as "listed" is deliberately narrow: an address of ours appearing in **their** payloads — the recipient table for our
 * payee, the facilitator table for the gas wallet. Not a submission, not a promise: their index either has us or it does not.
 */
export interface X402ScanListing {
  checkedAt: string;
  listedAt: string | null;
  anyListing: boolean;
  listed: { payeeInRecipients: boolean; facilitatorWalletInFacilitators: boolean };
}

export const X402SCAN_LISTING = generated as X402ScanListing;

/** True only when their index has us, so a page can render the block at all. */
export function isListedOnX402Scan(snapshot: X402ScanListing = X402SCAN_LISTING): boolean {
  return snapshot.anyListing === true;
}

/**
 * The sentence a lander shows, or `null`. Two variants because the two facts mean different things: a payee listing means a stranger
 * can find what we sell; a facilitator listing means our settlements are attributed to us. Neither is a claim about demand, and the
 * sentence says so.
 */
export function x402ScanListingSentence(snapshot: X402ScanListing = X402SCAN_LISTING): string | null {
  if (!isListedOnX402Scan(snapshot)) return null;
  const { payeeInRecipients, facilitatorWalletInFacilitators } = snapshot.listed;
  const parts: string[] = [];
  if (payeeInRecipients) parts.push("our payee appears in its recipient table, so an agent shopping for x402 sellers can find the endpoint");
  if (facilitatorWalletInFacilitators) parts.push("our settlement address appears in its facilitator table, so our settlements are attributed to us rather than to the facilitator we used before");
  if (parts.length === 0) return null;
  const date = snapshot.listedAt ? new Date(snapshot.listedAt).toISOString().slice(0, 10) : "an unrecorded date";
  return `Listed on x402scan since ${date}: ${parts.join("; and ")}. A listing is an index noticing us — not a customer, and not a claim about demand.`;
}
