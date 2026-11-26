import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { brandView, parseBrandConfig } from "../src/lib/brand.mjs";

const REPO_BRAND = JSON.parse(readFileSync(new URL("../../../brand.json", import.meta.url), "utf8"));

/** A known-good raw config, cloned per test so one mutation cannot leak into the next. */
const valid = () => ({ ...REPO_BRAND });

test("the repository brand.json parses under the demo mode", () => {
  const config = parseBrandConfig(valid(), {});
  assert.deepEqual(config, REPO_BRAND);
});

test("an unknown key is rejected and named", () => {
  const raw = { ...valid(), colour: "#000000" };
  assert.throws(
    () => parseBrandConfig(raw, {}),
    /brand\.json: unknown key "colour"\. Allowed keys: name, wordmark, tint, domain, mode, organizationName\./,
  );
});

test("a missing key is named", () => {
  const raw = valid();
  delete raw.tint;
  assert.throws(() => parseBrandConfig(raw, {}), /brand\.json: missing key "tint"\./);
});

test('mode "apple" without APPLE_PASS_CERT fails loudly and names the variable', () => {
  const raw = { ...valid(), mode: "apple" };
  assert.throws(
    () => parseBrandConfig(raw, {}),
    (error) => {
      assert.match(error.message, /mode is "apple"/);
      assert.match(error.message, /APPLE_PASS_CERT/);
      assert.match(error.message, /will not emit an unsigned or self-signed \.pkpass/);
      return true;
    },
  );
});

test('mode "apple" with APPLE_PASS_CERT passes the config gate', () => {
  const config = parseBrandConfig({ ...valid(), mode: "apple" }, { APPLE_PASS_CERT: "/tmp/test.p12" });
  assert.equal(config.mode, "apple");
});

test("changing name, tint and domain in the loaded config changes the lander view", () => {
  const original = brandView(parseBrandConfig(valid(), {}));
  assert.equal(original.homepage, `https://${REPO_BRAND.domain}/`);
  assert.equal(original.cssVariables["--vg-brand"], REPO_BRAND.tint);

  const changed = brandView(
    parseBrandConfig(
      {
        ...valid(),
        name: "Acme Ledger",
        wordmark: "ACME",
        tint: "#123456",
        domain: "pass.acme.example",
      },
      {},
    ),
  );

  // These are the values the lander renders (titles, hero copy, canonical URL, brand tint).
  assert.equal(changed.name, "Acme Ledger");
  assert.equal(changed.wordmark, "ACME");
  assert.equal(changed.title, "Acme Ledger — a wallet pass for agent spending limits");
  assert.equal(changed.description.startsWith("Acme Ledger puts"), true);
  assert.equal(changed.homepage, "https://pass.acme.example/");
  assert.equal(changed.verificationBase, "https://pass.acme.example");
  assert.equal(changed.cssVariables["--vg-brand"], "#123456");
  assert.notEqual(changed.homepage, original.homepage);
  assert.notEqual(changed.cssVariables["--vg-brand"], original.cssVariables["--vg-brand"]);
});
