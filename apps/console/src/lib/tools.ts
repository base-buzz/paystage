/**
 * The tool count, in one place.
 *
 * It was hardcoded as 5 in the hero proof strip while `packages/mcp` registered 9, and the same
 * number appeared in at least four other files. A number that lives in six places is a number that is
 * wrong in five of them — so it lives here, and `scripts/check-claims.mjs` fails the build when the
 * value drifts from the package that actually registers the tools.
 */
export const TOOL_COUNT = 9;
export const TOOL_COUNT_WORD = "nine";
