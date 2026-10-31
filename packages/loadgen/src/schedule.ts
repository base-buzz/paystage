export function dayIndexFromStart(startDate: string, now: Date): number {
  const start = Date.parse(startDate + "T00:00:00Z");
  if (Number.isNaN(start)) return -1;
  const ms = now.getTime() - start;
  if (ms < 0) return -1;
  return Math.floor(ms / 86_400_000);
}

export function callsRemainingToday(
  state: { callsToday: number },
  target: number,
): number {
  return Math.max(0, target - state.callsToday);
}
