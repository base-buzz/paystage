import { Badge } from "@/components/ui/badge";
import type { LiveStatus } from "@/lib/live-passes";

const VARIANT: Record<LiveStatus, "active" | "revoked" | "expired" | "unknown"> = {
  active: "active",
  revoked: "revoked",
  expired: "expired",
  unknown: "unknown",
};

const LABEL: Record<LiveStatus, string> = {
  active: "Active",
  revoked: "Revoked",
  expired: "Expired",
  unknown: "Unknown",
};

export function StatusBadge({ status }: { status: LiveStatus }) {
  return <Badge variant={VARIANT[status]}>{LABEL[status]}</Badge>;
}
