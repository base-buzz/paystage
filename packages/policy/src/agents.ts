/**
 * Per-agent budgets.
 *
 * A single policy for every agent on a machine is the wrong shape: the reading bot
 * that summarises articles and the trading bot that moves size should not share a
 * ceiling. Matching a payer's leash (which is global and operator-set) is not enough;
 * the rules need to be per-identity and they need to live with the operator.
 *
 * Two properties make this safe to add to an existing policy:
 *
 *  1. **Agents can only narrow, never widen.** An override that raises a ceiling, adds
 *     a payee or loosens `unknown_payee` is rejected at load, not silently applied.
 *     Otherwise a typo in one block becomes a spend incident.
 *  2. **Fail closed on identity.** Once a policy declares agents, a request without a
 *     known agent id is denied. Absent identity must never fall back to the global
 *     policy, because the global policy is the loosest thing in the file.
 */

import type { AmountSpec, Asset, Policy, UnknownPayee, VelocityWindow } from "./types.js";

export interface AgentBudget {
  /** Per-call ceiling. Must be <= the policy's `max_amount`. */
  max_amount?: AmountSpec;
  /** Per-day ceiling for this agent. Must be <= the policy's `daily_cap`. */
  daily_cap?: AmountSpec;
  /** Narrower payee list. Every entry must already be in `allowed_pay_to`. */
  allowed_pay_to?: string[];
  /** Narrower asset list. Every entry must already be in `allowed_assets`. */
  allowed_assets?: Asset[];
  /** Narrower network list. */
  allowed_networks?: string[];
  /** `review` may be tightened to `deny`; the reverse is rejected. */
  unknown_payee?: UnknownPayee;
  /** Overrides `require_human_above`, and must be lower (or equal). */
  require_human_above?: AmountSpec;
  /** Overrides the policy's velocity windows. */
  velocity?: { windows: VelocityWindow[] };
}

export interface AgentPolicy extends Policy {
  /** The id used to resolve this policy. */
  agent_id: string;
  /** Kept for completeness: the agent block is a narrowing overlay. */
  agents: NonNullable<Policy["agents"]>;
}

function toBaseUnits(spec: AmountSpec): bigint {
  const [whole, fraction = ""] = spec.value.split(".");
  const padded = (fraction + "0".repeat(spec.decimals)).slice(0, spec.decimals);
  return BigInt(`${whole}${padded}` || "0");
}

/** Compare two amount specs with the same asset and decimals. */
export function compareAmounts(a: AmountSpec, b: AmountSpec): number {
  const ba = toBaseUnits(a);
  const bb = toBaseUnits(b);
  return ba < bb ? -1 : ba > bb ? 1 : 0;
}

const sameAddress = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/**
 * Resolve a policy for one agent, or explain why it cannot be resolved.
 *
 * Returns a discriminated result rather than throwing, because the caller is a
 * payment path: a missing agent must produce `do_not_pay`, not an exception.
 */
export type AgentResolution =
  | { ok: true; policy: Policy; agentId: string }
  | { ok: false; reason: string };

export function resolveAgentPolicy(
  policy: Policy,
  agentId: string | undefined,
): AgentResolution {
  const agents = policy.agents;
  if (agents === undefined || Object.keys(agents).length === 0) {
    // No per-agent blocks: the global policy applies, and identity is optional.
    return { ok: true, policy, agentId: agentId ?? "default" };
  }

  if (agentId === undefined || agentId.trim() === "") {
    return {
      ok: false,
      reason:
        "this policy defines per-agent budgets, so the caller must identify itself with agent_id",
    };
  }

  const budget = agents[agentId];
  if (budget === undefined) {
    return { ok: false, reason: `unknown agent "${agentId}" — not listed in policy.agents` };
  }

  const merged: Policy = {
    ...policy,
    max_amount: budget.max_amount ?? policy.max_amount,
    daily_cap: budget.daily_cap ?? policy.daily_cap,
    allowed_pay_to: budget.allowed_pay_to ?? policy.allowed_pay_to,
    allowed_assets: budget.allowed_assets ?? policy.allowed_assets,
    allowed_networks: budget.allowed_networks ?? policy.allowed_networks,
    unknown_payee: budget.unknown_payee ?? policy.unknown_payee,
    velocity: budget.velocity ?? policy.velocity,
    ...(budget.require_human_above === undefined && policy.require_human_above === undefined
      ? {}
      : { require_human_above: budget.require_human_above ?? policy.require_human_above }),
  };

  const violation = findWidening(policy, budget);
  if (violation !== undefined) return { ok: false, reason: violation };

  return { ok: true, policy: merged, agentId };
}

/**
 * Reject any override that loosens the global policy. Returns a human-readable
 * problem or `undefined` when the block only narrows.
 */
export function findWidening(policy: Policy, budget: AgentBudget): string | undefined {
  if (budget.max_amount !== undefined && compareAmounts(budget.max_amount, policy.max_amount) > 0) {
    return "agent max_amount is above the policy max_amount — overrides may only narrow";
  }
  if (
    budget.daily_cap !== undefined &&
    policy.daily_cap !== undefined &&
    compareAmounts(budget.daily_cap, policy.daily_cap) > 0
  ) {
    return "agent daily_cap is above the policy daily_cap — overrides may only narrow";
  }
  if (budget.allowed_pay_to !== undefined) {
    const outside = budget.allowed_pay_to.filter(
      (entry) => !policy.allowed_pay_to.some((allowed) => sameAddress(allowed, entry)),
    );
    if (outside.length > 0) {
      return `agent allowed_pay_to adds payees outside the policy list: ${outside.join(", ")}`;
    }
  }
  if (budget.allowed_networks !== undefined) {
    const outside = budget.allowed_networks.filter((n) => !policy.allowed_networks.includes(n));
    if (outside.length > 0) {
      return `agent allowed_networks adds networks outside the policy list: ${outside.join(", ")}`;
    }
  }
  if (budget.allowed_assets !== undefined) {
    const outside = budget.allowed_assets.filter(
      (asset) =>
        !policy.allowed_assets.some(
          (allowed) =>
            sameAddress(allowed.address, asset.address) && allowed.network === asset.network,
        ),
    );
    if (outside.length > 0) {
      return `agent allowed_assets adds assets outside the policy list: ${outside
        .map((a) => a.symbol)
        .join(", ")}`;
    }
  }
  if (budget.unknown_payee === "review" && policy.unknown_payee === "deny") {
    return "agent unknown_payee loosens deny to review";
  }
  if (
    budget.require_human_above !== undefined &&
    policy.require_human_above !== undefined &&
    compareAmounts(budget.require_human_above, policy.require_human_above) > 0
  ) {
    return "agent require_human_above is above the policy threshold — overrides may only narrow";
  }
  return undefined;
}
