import tokens from "./pass-tokens.json";

/**
 * The page-side reader of the one token file (#440).
 *
 * `pass-tokens.json` is read by `scripts/lib/pass-face.mjs` and by the `/m/[serial]` page. This module is the
 * page's only entry point to it, so a component cannot quietly invent a colour or a size: if it is not here, it is
 * not on the page. JSON rather than `.ts` because the renderer is plain ESM — see `_note` in the file itself.
 *
 * `DEFAULT_TINT` is the tint of a pass whose teammate name is missing, which is what the mandate endpoint (#423)
 * returns today. `scripts/lib/pass-face.mjs` derives a tint by hashing the teammate name; an empty name hashes to
 * index 0, and a test pins `tintFor("") === PASS_TOKENS.posterTints[0]`. When the endpoint grows a name, the page
 * must use the renderer's `tintFor` rather than a second hash.
 */
export const PASS_TOKENS = tokens;

export const DEFAULT_TINT = tokens.posterTints[0];
