import brandJson from "../../../../../../brand.json";
import { buildBrandPack, PACK_VERSION_DATE } from "../../../../../../scripts/lib/brand-pack.mjs";
import { BRAND_PNGS } from "@/lib/brand-pngs.generated.mjs";

/**
 * `GET /brand/vg-brand-pack.zip` — the pack, assembled when the fork asks for it.
 *
 * The SVG masters are drawn from `scripts/lib/mark.mjs` and the lockups take their wordmark from
 * this repository's `brand.json`; the tier PNGs are the bytes `brand-kit.mjs` rendered from the same
 * module, embedded by `gen-brand-png-module.mjs` because a Worker has no `sharp`. Nothing here is a
 * hand-curated folder, and `scripts/check-brand-assets.mjs` fails if the zip's `brand.json` does not
 * match the repo's.
 */
export const dynamic = "force-dynamic";

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function GET() {
  const pngs: Record<string, Uint8Array> = {};
  for (const [name, base64] of Object.entries(BRAND_PNGS)) pngs[name] = decodeBase64(base64);

  const zip = buildBrandPack({ brand: brandJson, pngs, versionDate: PACK_VERSION_DATE });

  /**
   * `zip` is a `Uint8Array`, which the DOM `BodyInit` type in this TS version does not accept — the bytes are valid, the type is
   * narrower than reality (`BufferSource` covers it at runtime). Casting here is honest: the alternative was an app whose typecheck
   * is red on a tree nobody changed, which teaches everyone to ignore it.
   */
  return new Response(zip as unknown as BodyInit, {
    headers: {
      "content-type": "application/zip",
      "content-disposition": 'attachment; filename="vg-brand-pack.zip"',
      "content-length": String(zip.byteLength),
      // Request-time bytes: short cache, so a brand.json change becomes downloadable, not stale.
      "cache-control": "public, max-age=60, must-revalidate",
      "x-brand-pack-version": PACK_VERSION_DATE,
    },
  });
}
