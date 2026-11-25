/**
 * The two machine-readable surfaces that already exist, declared once.
 *
 * Next merges metadata shallowly: a page that sets `alternates.canonical` replaces the layout's whole
 * `alternates` object, so the same map has to be given to both the root layout and the landing page
 * or the links disappear on the one page that matters. Keeping the paths here means the two cannot
 * name different files.
 */
export const ALTERNATE_TYPES: Record<string, string> = {
  "text/plain": "/llms.txt",
  "application/json": "/.well-known/paystage.json",
};
