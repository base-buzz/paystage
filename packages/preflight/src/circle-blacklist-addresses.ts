/**
 * Circle USDC `Blacklisted(address)` addresses on Base, generated — do not edit.
 *
 * Source: Circle Internet Financial, the USDC contract on Base (chain 8453).
 * source_id: circle-blacklist
 * chain: Base (8453)
 * Event: Blacklisted(address), topic 0xffa4e6181777692565cf28528fc88fd1516ea86b56da075235fa575af6a4b855
 * contract: 0x833589fcd6edb6e08f4c7c32d4f71b54bda02913
 * collected_at: 2026-11-22T10:34:48.066Z
 * covered_from_block: 51000000
 * covered_to_block: 60766560
 * first_event_at: 2026-09-09T14:57:33.000Z
 * entries: 84
 * removed: 0
 * state_sha256: 38ef6f2644f08fd01c7165f1f2839c8e91298a8c8f1759c1649cd8cf700927e5
 *
 * Refresh with `node /work/ops/bin/circle-blacklist.mjs`; the hourly canary runs it beside OFAC and exports this file.
 * Addresses are lowercased; comparison is on the lowercased payee. This list holds Base (eip155:8453) events only.
 *
 * These are Circle's on-chain USDC freeze events, not OFAC sanctions targets. The two lists stay in separate modules
 * because a refusal that names the wrong basis is worse than a narrower list.
 */
export const CIRCLE_BLACKLISTED_ADDRESSES: ReadonlySet<string> = new Set([
  "0x04c3944f8fecc630e82910d5c4a2d00a795fa596",
  "0x08a05b6634012ac46646bb1f04a7f52ed8bfe762",
  "0x0de9cff3cc48924e6c470e55c15fffd815827846",
  "0x0decc02236cd75eb9c9bd63930c7638702e12df5",
  "0x0ede564e315f8e1803161a22e8404c624c35b1fb",
  "0x0f6ae73e9ced1a3fb5ff30a8ff702687a731769b",
  "0x12ea80238c7d805d003ce793594e92d84a6f4e8d",
  "0x17e7b121c25c23e1b967bfda72b7b45cab5b51e5",
  "0x1b875107ba4d38a5a894ad3d4393d32821a39036",
  "0x1b95eaaefd716e47d29baa10b629866ad79e4213",
  "0x1e282186e56f0f4f96288426116c4449ed287490",
  "0x1f09cb39c7949f1a18fcea1a3c584f718ef81933",
  "0x1faaaf31ebba5dde7a2bf48e010e6434d730fa92",
  "0x22c5fb75970fc1bbbd0fc76b76cdbfbd44b9dd83",
  "0x265e9b86ab3310003587a32c7a27f75f670a72ed",
  "0x28c6c06298d514db089934071355e5743bf21d60",
  "0x2bc0c9ff62958b94241e0f0585b0f84e84e3cd8e",
  "0x2eb686610c46545a118f5b8228cf1e46df242352",
  "0x386231af22383f533b959a6a1379f1e5cfc22989",
  "0x3f7bac9d68a8e45d0b5654633eecafd4ec3d4fbe",
  "0x437c5cb414410bd4a628e4764ab61b7f44e6402f",
  "0x46ef4466249d1eb324b58be21cbadfb852dd6b7c",
  "0x48e5cb660dd19aea9d1b87a2859570192d40af10",
  "0x4a33953b63657ea4f2701088704c107460787302",
  "0x4c03d82270c117644a8001671c52111bdb15ee6d",
  "0x4d4f1236d9951681ce944ce1ead15cb972a9cf2f",
  "0x502d46e39e61b60eaba79dd6a6270445c141b6f0",
  "0x538947722f7ca77098803112fa3d188b054b5456",
  "0x55011219931443eede49ee3efa42b2264226fe98",
  "0x572b48da5c3fff3c9230fc2115e575a5954866cb",
  "0x5772f441155c532eb7d929ca079cb7e673a39286",
  "0x591c430024fce05a9d657d1fa3eba15109e48600",
  "0x5b39ebcd59f7b5071fa35b16f068f0ea243d3bf3",
  "0x5d048eb6877ce03deb35c48c6550def1c05961b8",
  "0x601d77306917263f0ea2a8fa8a7516b3aa0a0a1f",
  "0x6396745d7a9236229d17684d826bf2792ed7d457",
  "0x67ab9ee65660fa10967722a7552e5e96e8192776",
  "0x712779ce813e780c08ad89f83153f2a503bf3b8f",
  "0x761edd5e4546229a0bd35ae99b4d3d01cf4a3510",
  "0x78b3ad18b66c41f766bbf452a609d004a2b2a1e1",
  "0x7aa0cffa2ac86a7ea54c0c63866d98071c79f44e",
  "0x7fea703f97cdf8d607513231f8f3310e56096863",
  "0x8419e7824e785c4ac8d9d94a0093c437ab1ff320",
  "0x8926c7ce09f08731c51564e2ba714f800e23a65a",
  "0x8e4db52262cc6dbf7158cb57b2d8da67bd62cd91",
  "0x9138a1ef23019dba58acd3a221c442073c313c73",
  "0x9c0605e0df7fdb655204b901b62be5a4bb89fdcc",
  "0x9d76a551e7cebbba57155f77beca8c2971894502",
  "0xa18ef3a679e2942596a67eb871845da89b7eeaa8",
  "0xa669e919ee02d1dc6b2ddc2f4cc16fd18b11e9aa",
  "0xaf8bcc21bfdcf2378d8f804d2b79264efe4e6b4a",
  "0xb84896db62780c6e3a04f1d5a3e91c7ad6cfd819",
  "0xbb7aac3cf72810aeaebb07649d873f9a7e9701e1",
  "0xc05612c9f78a909886320628f3ee59dc7baffdfd",
  "0xc06198bd95b602889e5a770c80643b5b292526c3",
  "0xc0cdb1a32790dbed8536b904296283dcef82bf29",
  "0xc275eb6d33797bc2e3dccd3c30afb042b1069bb6",
  "0xc2d06dae23a6f772d0b49d5b4dccb501fc3862f4",
  "0xc35033e93c38f5434de52d0d5f8f92f8a679cf1f",
  "0xc3bdc27427ce1aa2b92c81bc8032918697bbc645",
  "0xc4232d1bb5276a312b19414e11e2fc1e02a56463",
  "0xdb0845207e61e132d3153358966b552284c194b5",
  "0xdc8cb80786ed2823e5d6cdf22bd542db5b5b4b96",
  "0xdca63d36e326fdcde1c6403ff3edf5d8ba7699ad",
  "0xdeedc6c3a269b07a05a0737d248c798ec7455440",
  "0xdf15822aceca390e21d9a44702c7ffc4cb2285e7",
  "0xe007afe5a5abfdf4efbbae239f42819b97e95e5d",
  "0xe485e7a70b1131216cb47ca4555c4bbb2c742478",
  "0xe4c9a7f68b1eba4508f54f07f7378847318dd1a3",
  "0xe4eacf8d5b0b68e6250d4f5710d24c9de5882a65",
  "0xe9d12c5d6954487fba2ce36a0b0ab5c8515dbb98",
  "0xea7afc65367dd5a870e1a0ddf376181b36e9c8ab",
  "0xeba36fb30acdc3eba9283e6514fff8a99149a63a",
  "0xee7ae85f2fe2239e27d9c1e23fffe168d63b4055",
  "0xeeeef5ced57f622277935bd14b723345f7efee1c",
  "0xef2d50d0b3820e1305fcdabad65dbef5c5848aa4",
  "0xf064109090e30203afffe233c9acefdbeee78099",
  "0xf7c65e485eeb47fecea7c47315c97d61305d3def",
  "0xf9d66d6842ae81cfb1b04f651a19798cdf1ee3a3",
  "0xfabfd02cd685b83cc86aea83848d69439b54c720",
  "0xfbd36c041070f28fd0498166be6494065bec5f0e",
  "0xfd34841893a1dc5c6af5b5e65818d82e219c1275",
  "0xfe24ed2a9f9f02cdb715e85c3450b502912ee622",
  "0xffc4041cf54a41d4fef327a8b5d31b860a26492f",
]);

/** When this corpus was exported, so a verdict can say how stale its screening is. */
export const CIRCLE_BLACKLIST_FETCHED_AT = "2026-11-22T10:34:48.066Z";

/** Base mainnet — the only chain this corpus covers; the evaluator applies it to that CAIP-2 network only. */
export const CIRCLE_BLACKLIST_CHAIN_ID = 8453;

/** The earliest block this copy actually covers. Events below it are absent, not empty. */
export const CIRCLE_BLACKLIST_COVERED_FROM_BLOCK = 51000000;

/** The block's timestamp of the first collected event; a chain fact, not the export time. */
export const CIRCLE_BLACKLIST_FIRST_EVENT_AT = "2026-09-09T14:57:33.000Z";
