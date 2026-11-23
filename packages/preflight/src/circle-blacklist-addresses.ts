/**
 * Circle USDC `Blacklisted(address)` / `UnBlacklisted(address)` state on Base, generated — do not edit.
 *
 * Source: Circle Internet Financial, the USDC contract on Base (chain 8453).
 * source_id: circle-blacklist
 * chain: Base (8453)
 * Event: Blacklisted(address), topic 0xffa4e6181777692565cf28528fc88fd1516ea86b56da075235fa575af6a4b855
 * Event: UnBlacklisted(address), topic 0x117e3210bb9aa7d9baff172026820255c6f6c30ba8999d1c2fd88e2848137c4e
 * contract: 0x833589fcd6edb6e08f4c7c32d4f71b54bda02913
 * collected_at: 2026-11-23T20:42:13.900Z
 * covered_from_block: 51000000
 * covered_to_block: 61380789
 * first_event_at: 2026-09-09T14:57:33.000Z
 * last_event_at: 2026-11-19T14:48:16.000Z
 * last_unblacklist_at: null
 * events: 84
 * blacklisted: 84
 * unblacklisted: 0
 * removed: 0
 * state_sha256: bfe48c88c387840db845c61ea9d5d23c91c1e8874a3859ba63fdff02083867d3
 *
 * Refresh with `node /work/ops/bin/circle-blacklist.mjs`; the hourly canary runs it beside OFAC and exports this file.
 * Addresses are lowercased; comparison is on the lowercased payee. This file holds Base (eip155:8453) events only.
 *
 * RULE — latest event wins: an address's current state is the state of its latest event by (blockNumber, logIndex).
 * A freeze followed by an unfreeze is `unblacklisted`; a later freeze puts it back to `blacklisted`. `since` is that
 * winning event's block timestamp and `blockNumber` is its block. The evaluator refuses only `blacklisted` entries;
 * an `unblacklisted` one is recorded so a verdict can say the freeze was lifted rather than never seen.
 *
 * These are Circle's on-chain USDC freeze events, not OFAC sanctions targets. The two lists stay in separate modules
 * because a refusal that names the wrong basis is worse than a narrower list.
 */
export type CircleBlacklistEntryState = "blacklisted" | "unblacklisted";

export interface CircleBlacklistState {
  readonly address: string;
  readonly state: CircleBlacklistEntryState;
  /** Block timestamp (ISO 8601) of the event that decides `state`; null when this copy predates timestamp capture. */
  readonly since: string | null;
  /** Block containing that event, so a reader can check it on BaseScan. */
  readonly blockNumber: number;
}

/** One row per address, sorted by address. The current state, not a list of events. */
export const CIRCLE_BLACKLIST_STATES: readonly CircleBlacklistState[] = [
  { address: "0x04c3944f8fecc630e82910d5c4a2d00a795fa596", state: "blacklisted", since: "2026-09-09T16:46:17.000Z", blockNumber: 51091515 },
  { address: "0x08a05b6634012ac46646bb1f04a7f52ed8bfe762", state: "blacklisted", since: "2026-09-09T15:55:05.000Z", blockNumber: 51089979 },
  { address: "0x0de9cff3cc48924e6c470e55c15fffd815827846", state: "blacklisted", since: "2026-09-30T14:38:35.000Z", blockNumber: 51994884 },
  { address: "0x0decc02236cd75eb9c9bd63930c7638702e12df5", state: "blacklisted", since: "2026-09-09T16:28:31.000Z", blockNumber: 51090982 },
  { address: "0x0ede564e315f8e1803161a22e8404c624c35b1fb", state: "blacklisted", since: "2026-09-09T14:57:33.000Z", blockNumber: 51088253 },
  { address: "0x0f6ae73e9ced1a3fb5ff30a8ff702687a731769b", state: "blacklisted", since: "2026-09-09T15:01:01.000Z", blockNumber: 51088357 },
  { address: "0x12ea80238c7d805d003ce793594e92d84a6f4e8d", state: "blacklisted", since: "2026-10-28T14:41:17.000Z", blockNumber: 53204565 },
  { address: "0x17e7b121c25c23e1b967bfda72b7b45cab5b51e5", state: "blacklisted", since: "2026-11-06T23:42:51.000Z", blockNumber: 54090977 },
  { address: "0x1b875107ba4d38a5a894ad3d4393d32821a39036", state: "blacklisted", since: "2026-09-30T14:33:47.000Z", blockNumber: 51994740 },
  { address: "0x1b95eaaefd716e47d29baa10b629866ad79e4213", state: "blacklisted", since: "2026-10-28T14:42:43.000Z", blockNumber: 53204608 },
  { address: "0x1e282186e56f0f4f96288426116c4449ed287490", state: "blacklisted", since: "2026-09-30T14:39:49.000Z", blockNumber: 51994921 },
  { address: "0x1f09cb39c7949f1a18fcea1a3c584f718ef81933", state: "blacklisted", since: "2026-09-09T16:30:39.000Z", blockNumber: 51091046 },
  { address: "0x1faaaf31ebba5dde7a2bf48e010e6434d730fa92", state: "blacklisted", since: "2026-11-06T19:59:04.000Z", blockNumber: 54023845 },
  { address: "0x22c5fb75970fc1bbbd0fc76b76cdbfbd44b9dd83", state: "blacklisted", since: "2026-10-06T17:25:59.000Z", blockNumber: 52259106 },
  { address: "0x265e9b86ab3310003587a32c7a27f75f670a72ed", state: "blacklisted", since: "2026-09-09T15:10:45.000Z", blockNumber: 51088649 },
  { address: "0x28c6c06298d514db089934071355e5743bf21d60", state: "blacklisted", since: "2026-10-29T23:54:27.000Z", blockNumber: 53264360 },
  { address: "0x2bc0c9ff62958b94241e0f0585b0f84e84e3cd8e", state: "blacklisted", since: "2026-09-30T14:44:29.000Z", blockNumber: 51995061 },
  { address: "0x2eb686610c46545a118f5b8228cf1e46df242352", state: "blacklisted", since: "2026-09-09T15:08:25.000Z", blockNumber: 51088579 },
  { address: "0x386231af22383f533b959a6a1379f1e5cfc22989", state: "blacklisted", since: "2026-09-09T16:27:17.000Z", blockNumber: 51090945 },
  { address: "0x3f7bac9d68a8e45d0b5654633eecafd4ec3d4fbe", state: "blacklisted", since: "2026-10-28T14:44:35.000Z", blockNumber: 53204664 },
  { address: "0x437c5cb414410bd4a628e4764ab61b7f44e6402f", state: "blacklisted", since: "2026-09-09T15:04:33.000Z", blockNumber: 51088463 },
  { address: "0x46ef4466249d1eb324b58be21cbadfb852dd6b7c", state: "blacklisted", since: "2026-09-09T15:01:43.000Z", blockNumber: 51088378 },
  { address: "0x48e5cb660dd19aea9d1b87a2859570192d40af10", state: "blacklisted", since: "2026-09-09T15:47:41.000Z", blockNumber: 51089757 },
  { address: "0x4a33953b63657ea4f2701088704c107460787302", state: "blacklisted", since: "2026-09-09T15:48:59.000Z", blockNumber: 51089796 },
  { address: "0x4c03d82270c117644a8001671c52111bdb15ee6d", state: "blacklisted", since: "2026-09-09T16:33:29.000Z", blockNumber: 51091131 },
  { address: "0x4d4f1236d9951681ce944ce1ead15cb972a9cf2f", state: "blacklisted", since: "2026-09-09T15:37:01.000Z", blockNumber: 51089437 },
  { address: "0x502d46e39e61b60eaba79dd6a6270445c141b6f0", state: "blacklisted", since: "2026-09-09T15:33:41.000Z", blockNumber: 51089337 },
  { address: "0x538947722f7ca77098803112fa3d188b054b5456", state: "blacklisted", since: "2026-11-06T20:01:33.000Z", blockNumber: 54024590 },
  { address: "0x55011219931443eede49ee3efa42b2264226fe98", state: "blacklisted", since: "2026-09-09T15:02:43.000Z", blockNumber: 51088408 },
  { address: "0x572b48da5c3fff3c9230fc2115e575a5954866cb", state: "blacklisted", since: "2026-10-06T17:24:59.000Z", blockNumber: 52259076 },
  { address: "0x5772f441155c532eb7d929ca079cb7e673a39286", state: "blacklisted", since: "2026-09-30T14:34:31.000Z", blockNumber: 51994762 },
  { address: "0x591c430024fce05a9d657d1fa3eba15109e48600", state: "blacklisted", since: "2026-09-09T16:13:33.000Z", blockNumber: 51090533 },
  { address: "0x5b39ebcd59f7b5071fa35b16f068f0ea243d3bf3", state: "blacklisted", since: "2026-11-06T20:03:42.000Z", blockNumber: 54025236 },
  { address: "0x5d048eb6877ce03deb35c48c6550def1c05961b8", state: "blacklisted", since: "2026-11-06T20:04:12.000Z", blockNumber: 54025384 },
  { address: "0x601d77306917263f0ea2a8fa8a7516b3aa0a0a1f", state: "blacklisted", since: "2026-09-30T14:31:21.000Z", blockNumber: 51994667 },
  { address: "0x6396745d7a9236229d17684d826bf2792ed7d457", state: "blacklisted", since: "2026-09-09T15:18:57.000Z", blockNumber: 51088895 },
  { address: "0x67ab9ee65660fa10967722a7552e5e96e8192776", state: "blacklisted", since: "2026-09-09T15:16:49.000Z", blockNumber: 51088831 },
  { address: "0x712779ce813e780c08ad89f83153f2a503bf3b8f", state: "blacklisted", since: "2026-09-09T15:33:07.000Z", blockNumber: 51089320 },
  { address: "0x761edd5e4546229a0bd35ae99b4d3d01cf4a3510", state: "blacklisted", since: "2026-10-28T14:48:11.000Z", blockNumber: 53204772 },
  { address: "0x78b3ad18b66c41f766bbf452a609d004a2b2a1e1", state: "blacklisted", since: "2026-11-06T20:07:39.000Z", blockNumber: 54026419 },
  { address: "0x7aa0cffa2ac86a7ea54c0c63866d98071c79f44e", state: "blacklisted", since: "2026-09-09T16:19:19.000Z", blockNumber: 51090706 },
  { address: "0x7fea703f97cdf8d607513231f8f3310e56096863", state: "blacklisted", since: "2026-09-09T16:47:41.000Z", blockNumber: 51091557 },
  { address: "0x8419e7824e785c4ac8d9d94a0093c437ab1ff320", state: "blacklisted", since: "2026-11-02T18:58:29.000Z", blockNumber: 53428281 },
  { address: "0x8926c7ce09f08731c51564e2ba714f800e23a65a", state: "blacklisted", since: "2026-09-09T16:40:09.000Z", blockNumber: 51091331 },
  { address: "0x8e4db52262cc6dbf7158cb57b2d8da67bd62cd91", state: "blacklisted", since: "2026-09-09T15:50:29.000Z", blockNumber: 51089841 },
  { address: "0x9138a1ef23019dba58acd3a221c442073c313c73", state: "blacklisted", since: "2026-09-09T16:19:49.000Z", blockNumber: 51090721 },
  { address: "0x9c0605e0df7fdb655204b901b62be5a4bb89fdcc", state: "blacklisted", since: "2026-10-28T14:46:53.000Z", blockNumber: 53204733 },
  { address: "0x9d76a551e7cebbba57155f77beca8c2971894502", state: "blacklisted", since: "2026-10-28T14:55:35.000Z", blockNumber: 53204994 },
  { address: "0xa18ef3a679e2942596a67eb871845da89b7eeaa8", state: "blacklisted", since: "2026-09-09T15:36:31.000Z", blockNumber: 51089422 },
  { address: "0xa669e919ee02d1dc6b2ddc2f4cc16fd18b11e9aa", state: "blacklisted", since: "2026-09-09T15:47:55.000Z", blockNumber: 51089764 },
  { address: "0xaf8bcc21bfdcf2378d8f804d2b79264efe4e6b4a", state: "blacklisted", since: "2026-09-09T15:57:13.000Z", blockNumber: 51090043 },
  { address: "0xb84896db62780c6e3a04f1d5a3e91c7ad6cfd819", state: "blacklisted", since: "2026-09-09T16:27:07.000Z", blockNumber: 51090940 },
  { address: "0xbb7aac3cf72810aeaebb07649d873f9a7e9701e1", state: "blacklisted", since: "2026-09-09T16:05:53.000Z", blockNumber: 51090303 },
  { address: "0xc05612c9f78a909886320628f3ee59dc7baffdfd", state: "blacklisted", since: "2026-09-09T16:37:17.000Z", blockNumber: 51091245 },
  { address: "0xc06198bd95b602889e5a770c80643b5b292526c3", state: "blacklisted", since: "2026-09-09T15:19:05.000Z", blockNumber: 51088899 },
  { address: "0xc0cdb1a32790dbed8536b904296283dcef82bf29", state: "blacklisted", since: "2026-09-09T16:27:15.000Z", blockNumber: 51090944 },
  { address: "0xc275eb6d33797bc2e3dccd3c30afb042b1069bb6", state: "blacklisted", since: "2026-09-09T16:12:07.000Z", blockNumber: 51090490 },
  { address: "0xc2d06dae23a6f772d0b49d5b4dccb501fc3862f4", state: "blacklisted", since: "2026-09-09T16:01:07.000Z", blockNumber: 51090160 },
  { address: "0xc35033e93c38f5434de52d0d5f8f92f8a679cf1f", state: "blacklisted", since: "2026-09-09T15:39:13.000Z", blockNumber: 51089503 },
  { address: "0xc3bdc27427ce1aa2b92c81bc8032918697bbc645", state: "blacklisted", since: "2026-10-08T22:58:49.000Z", blockNumber: 52355491 },
  { address: "0xc4232d1bb5276a312b19414e11e2fc1e02a56463", state: "blacklisted", since: "2026-09-09T16:44:53.000Z", blockNumber: 51091473 },
  { address: "0xdb0845207e61e132d3153358966b552284c194b5", state: "blacklisted", since: "2026-11-19T14:48:16.000Z", blockNumber: 59546604 },
  { address: "0xdc8cb80786ed2823e5d6cdf22bd542db5b5b4b96", state: "blacklisted", since: "2026-11-06T20:10:42.000Z", blockNumber: 54027332 },
  { address: "0xdca63d36e326fdcde1c6403ff3edf5d8ba7699ad", state: "blacklisted", since: "2026-09-09T15:01:27.000Z", blockNumber: 51088370 },
  { address: "0xdeedc6c3a269b07a05a0737d248c798ec7455440", state: "blacklisted", since: "2026-09-09T16:16:09.000Z", blockNumber: 51090611 },
  { address: "0xdf15822aceca390e21d9a44702c7ffc4cb2285e7", state: "blacklisted", since: "2026-09-30T14:43:45.000Z", blockNumber: 51995039 },
  { address: "0xe007afe5a5abfdf4efbbae239f42819b97e95e5d", state: "blacklisted", since: "2026-09-09T15:17:09.000Z", blockNumber: 51088841 },
  { address: "0xe485e7a70b1131216cb47ca4555c4bbb2c742478", state: "blacklisted", since: "2026-11-02T16:19:49.000Z", blockNumber: 53423521 },
  { address: "0xe4c9a7f68b1eba4508f54f07f7378847318dd1a3", state: "blacklisted", since: "2026-10-28T14:53:47.000Z", blockNumber: 53204940 },
  { address: "0xe4eacf8d5b0b68e6250d4f5710d24c9de5882a65", state: "blacklisted", since: "2026-09-09T15:06:05.000Z", blockNumber: 51088509 },
  { address: "0xe9d12c5d6954487fba2ce36a0b0ab5c8515dbb98", state: "blacklisted", since: "2026-09-09T15:24:25.000Z", blockNumber: 51089059 },
  { address: "0xea7afc65367dd5a870e1a0ddf376181b36e9c8ab", state: "blacklisted", since: "2026-10-06T17:23:59.000Z", blockNumber: 52259046 },
  { address: "0xeba36fb30acdc3eba9283e6514fff8a99149a63a", state: "blacklisted", since: "2026-09-09T16:02:43.000Z", blockNumber: 51090208 },
  { address: "0xee7ae85f2fe2239e27d9c1e23fffe168d63b4055", state: "blacklisted", since: "2026-10-29T23:55:11.000Z", blockNumber: 53264382 },
  { address: "0xeeeef5ced57f622277935bd14b723345f7efee1c", state: "blacklisted", since: "2026-09-09T15:41:59.000Z", blockNumber: 51089586 },
  { address: "0xef2d50d0b3820e1305fcdabad65dbef5c5848aa4", state: "blacklisted", since: "2026-10-28T14:58:49.000Z", blockNumber: 53205091 },
  { address: "0xf064109090e30203afffe233c9acefdbeee78099", state: "blacklisted", since: "2026-09-09T16:26:37.000Z", blockNumber: 51090925 },
  { address: "0xf7c65e485eeb47fecea7c47315c97d61305d3def", state: "blacklisted", since: "2026-09-09T16:15:47.000Z", blockNumber: 51090600 },
  { address: "0xf9d66d6842ae81cfb1b04f651a19798cdf1ee3a3", state: "blacklisted", since: "2026-09-09T15:06:37.000Z", blockNumber: 51088525 },
  { address: "0xfabfd02cd685b83cc86aea83848d69439b54c720", state: "blacklisted", since: "2026-09-09T15:45:55.000Z", blockNumber: 51089704 },
  { address: "0xfbd36c041070f28fd0498166be6494065bec5f0e", state: "blacklisted", since: "2026-09-09T15:13:33.000Z", blockNumber: 51088733 },
  { address: "0xfd34841893a1dc5c6af5b5e65818d82e219c1275", state: "blacklisted", since: "2026-09-09T16:43:39.000Z", blockNumber: 51091436 },
  { address: "0xfe24ed2a9f9f02cdb715e85c3450b502912ee622", state: "blacklisted", since: "2026-09-09T16:01:57.000Z", blockNumber: 51090185 },
  { address: "0xffc4041cf54a41d4fef327a8b5d31b860a26492f", state: "blacklisted", since: "2026-10-22T01:07:57.000Z", blockNumber: 52920965 },
];

/** The enforced set: addresses whose latest event is a freeze. Derived, never retyped. */
export const CIRCLE_BLACKLISTED_ADDRESSES: ReadonlySet<string> = new Set(
  CIRCLE_BLACKLIST_STATES.filter((entry) => entry.state === "blacklisted").map((entry) => entry.address),
);

/** When this corpus was exported, so a verdict can say how stale its screening is. */
export const CIRCLE_BLACKLIST_FETCHED_AT = "2026-11-23T20:42:13.900Z";

/** Base mainnet — the only chain this corpus covers; the evaluator applies it to that CAIP-2 network only. */
export const CIRCLE_BLACKLIST_CHAIN_ID = 8453;

/** The earliest block this copy actually covers. Events below it are absent, not empty. */
export const CIRCLE_BLACKLIST_COVERED_FROM_BLOCK = 51000000;

/** The block's timestamp of the first collected event; a chain fact, not the export time. */
export const CIRCLE_BLACKLIST_FIRST_EVENT_AT = "2026-09-09T14:57:33.000Z";

/** The block's timestamp of the latest Blacklisted or UnBlacklisted event collected. */
export const CIRCLE_BLACKLIST_LAST_EVENT_AT = "2026-11-19T14:48:16.000Z";

/** The latest UnBlacklisted event collected, or null when none is in the covered range. */
export const CIRCLE_BLACKLIST_LAST_UNBLACKLIST_AT = null;

export const CIRCLE_BLACKLISTED_TOPIC = "0xffa4e6181777692565cf28528fc88fd1516ea86b56da075235fa575af6a4b855";
export const CIRCLE_UNBLACKLISTED_TOPIC = "0x117e3210bb9aa7d9baff172026820255c6f6c30ba8999d1c2fd88e2848137c4e";
