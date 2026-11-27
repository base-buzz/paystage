import type { MockStatus } from "@/lib/mocks";

const LABELS: Record<MockStatus, string> = {
  drawn: "drawn",
  live: "live",
  "not built": "not built",
};

const CLASS: Record<MockStatus, string> = {
  drawn: "mocks-chip--drawn",
  live: "mocks-chip--live",
  "not built": "mocks-chip--not-built",
};

/**
 * The one chip used by the index and by every story frame.
 *
 * The word is the API: `drawn` means an image exists and it is a drawing, `live` means the feature is live (and the
 * frame may deliberately have no image), `not built` means neither. A page that paints an image under `not built`
 * has already defeated the point of the chip.
 */
export function StatusChip({ status }: { status: MockStatus }) {
  return (
    <span className={`mocks-chip ${CLASS[status]}`} data-status={status}>
      <span className="mocks-chip-dot" aria-hidden="true" />
      {LABELS[status]}
    </span>
  );
}
