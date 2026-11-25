export type OwnProvenance = "own-ci" | "own-loadgen" | "own-probe";

/**
 * Provenance headers for a request to the PayStage gate, or `{}` when
 * `PAYSTAGE_PROVENANCE_KEY` is absent. Never throws, never logs.
 */
export function provenanceHeaders(
  value: OwnProvenance,
  key?: string,
): Promise<Record<string, string>>;
