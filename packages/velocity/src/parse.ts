import type { Policy, VelocityWindow } from "@paystage/policy";

/**
 * Extract velocity windows from a policy. Returns an empty array when the
 * policy has no `velocity` field.
 */
export function parseVelocityPolicy(policy: Policy | unknown): VelocityWindow[] {
  if (policy === null || typeof policy !== "object") {
    return [];
  }
  const velocity = (policy as { velocity?: unknown }).velocity;
  if (velocity === null || typeof velocity !== "object") {
    return [];
  }
  const windows = (velocity as { windows?: unknown }).windows;
  if (!Array.isArray(windows)) {
    return [];
  }
  return windows as VelocityWindow[];
}
