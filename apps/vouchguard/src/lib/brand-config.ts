/**
 * The app's single binding to the repo-root `brand.json`.
 *
 * Everything that renders a name, wordmark, tint, domain or mode reads this module. There
 * is intentionally no fallback: if the file is absent, malformed, or says `mode: "apple"`
 * without `APPLE_PASS_CERT`, importing this module throws and the build fails. That is the
 * "fails loudly" half of the contract.
 *
 * The JSON lives at the repository root so a fork edits one file and not this app's tree.
 * See `docs/specs/fork.md`.
 */
import brandJson from "../../../../brand.json";
import { brandView as toBrandView, parseBrandConfig } from "./brand.mjs";

export const brand = parseBrandConfig(brandJson, process.env);
export const view = toBrandView(brand);
