import { Badge } from "@/components/ui/badge";
import type { PassStatus } from "@/lib/demo-data";

const VARIANT: Record<PassStatus, "active" | "revoked" | "expired"> = {
  active: "active",
  revoked: "revoked",
  expired: "expired",
};

const LABEL: Record<PassStatus, string> = {
  active: "Active",
  revoked: "Revoked",
  expired: "Expired",
};

export function StatusBadge({ status }: { status: PassStatus }) {
  return <Badge variant={VARIANT[status]}>{LABEL[status]}</Badge>;
}
