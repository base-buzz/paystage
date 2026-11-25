/**
 * The Apple pass images. They are the rendered Vouch assets, copied into the package so the generator
 * works when installed outside the monorepo. `tests/pass.test.ts` compares them byte-for-byte with
 * `apps/console/public/pass/` — a copy that drifts from the renderer is the failure this guards.
 */

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

export interface PassAssets {
  icon: Buffer;
  logo: Buffer;
  strip: Buffer;
}

/** `packages/pass/assets` from both `src/assets.ts` and `dist/assets.js`. */
export const DEFAULT_ASSETS_DIR = fileURLToPath(new URL("../assets", import.meta.url));

export interface AssetOptions {
  /** Explicit image bytes. Supplying all three skips the filesystem. */
  assets?: PassAssets;
  /** A directory containing icon.png, logo.png and strip.png. */
  assetsDir?: string;
}

async function readAsset(dir: string, name: string): Promise<Buffer> {
  try {
    return await readFile(`${dir}/${name}`);
  } catch {
    throw new Error(`could not read pass asset ${name} from ${dir}; run node scripts/render-pass-assets.mjs`);
  }
}

export async function loadPassAssets(options: AssetOptions = {}): Promise<PassAssets> {
  if (options.assets) return options.assets;
  const dir = options.assetsDir ?? DEFAULT_ASSETS_DIR;
  const [icon, logo, strip] = await Promise.all([
    readAsset(dir, "icon.png"),
    readAsset(dir, "logo.png"),
    readAsset(dir, "strip.png"),
  ]);
  return { icon, logo, strip };
}
