export type Scenario = "allow" | "policy_block" | "velocity_deny";

export function pickScenario(rng: () => number): Scenario {
  const r = rng();
  if (r < 0.5) return "allow";
  if (r < 0.75) return "policy_block";
  return "velocity_deny";
}
