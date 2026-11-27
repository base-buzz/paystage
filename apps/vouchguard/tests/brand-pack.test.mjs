import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  PACK_PNG_NAMES,
  PACK_VERSION_DATE,
  buildBrandPack,
  readStoreZip,
} from "../../../scripts/lib/brand-pack.mjs";

const REPO_BRAND = JSON.parse(readFileSync(new URL("../../../brand.json", import.meta.url), "utf8"));
const PNGS = Object.fromEntries(
  PACK_PNG_NAMES.map((name) => [name, readFileSync(new URL(`../../../brand/${name}`, import.meta.url))]),
);

const decode = (zip, name) => new TextDecoder().decode(readStoreZip(zip).get(name));

test("the pack's brand.json is the repository's, name and all", () => {
  const zipped = JSON.parse(decode(buildBrandPack({ brand: REPO_BRAND, pngs: PNGS }), "brand.json"));
  assert.deepEqual(zipped, REPO_BRAND);
  assert.equal(zipped.name, REPO_BRAND.name);
});

test("a different brand is what the pack says — the builder has no hidden default", () => {
  const other = { ...REPO_BRAND, name: "Northwind", wordmark: "Northwind" };
  const zipped = JSON.parse(decode(buildBrandPack({ brand: other, pngs: PNGS }), "brand.json"));
  assert.equal(zipped.name, "Northwind");
  assert.equal(zipped.wordmark, "Northwind");
});

test("the zip's VERSION and README carry the same spec date", () => {
  const zip = buildBrandPack({ brand: REPO_BRAND, pngs: PNGS, versionDate: PACK_VERSION_DATE });
  const entries = readStoreZip(zip);
  assert.equal(new TextDecoder().decode(entries.get("VERSION")).trim(), PACK_VERSION_DATE);
  assert.match(new TextDecoder().decode(entries.get("README.txt")), new RegExp(`Version — ${PACK_VERSION_DATE}`));
});

test("the archive is reproducible: two builds are byte-identical", () => {
  assert.deepEqual(
    buildBrandPack({ brand: REPO_BRAND, pngs: PNGS }),
    buildBrandPack({ brand: REPO_BRAND, pngs: PNGS }),
  );
});

test("every promised entry is present and the PNGs are PNGs", () => {
  const entries = readStoreZip(buildBrandPack({ brand: REPO_BRAND, pngs: PNGS }));
  for (const name of [
    "README.txt",
    "VERSION",
    "LICENCE",
    "LICENCE-LUCIDE",
    "brand.json",
    "svg/mark.svg",
    "svg/mark-revoked.svg",
    "svg/mark-expired.svg",
    "svg/mark-mono.svg",
    "svg/mark-icon.svg",
    "svg/lockup-vertical.svg",
    "svg/lockup-horizontal.svg",
  ]) {
    assert.ok(entries.has(name), `${name} is missing from the zip`);
  }
  for (const name of PACK_PNG_NAMES) {
    const data = entries.get(`png/${name}`);
    assert.ok(data && data.length > 8, `png/${name} is missing`);
    assert.deepEqual([...data.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47], `png/${name} is not a PNG`);
  }
});
