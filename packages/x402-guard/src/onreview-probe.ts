/**
 * The `onReview` default, in one place, so a test can pin it.
 *
 * `src/index.ts` reads `options.onReview ?? "pay"`. That literal is the behaviour a caller gets when they do not decide, and it contradicts the instruction our
 * own skill gives agents ("review means stop and ask"). Exposing it here means the default is asserted rather than implied — and changing it in the next major
 * touches one function instead of hunting a literal.
 */
export function severityOfDefault(options: { explicit?: "pay" | "refuse" } = {}): "pay" | "refuse" {
  return options.explicit ?? "pay";
}
