export function humanToAtomic(human: string, decimals: number): bigint {
  if (!/^\d+(?:\.\d+)?$/.test(human)) {
    throw new Error(`Invalid decimal amount: ${human}`);
  }

  if (!Number.isInteger(decimals) || decimals < 0) {
    throw new Error("decimals must be a non-negative integer");
  }

  const [whole, fraction = ""] = human.split(".");

  if (fraction.length > decimals) {
    throw new Error(
      `Too many decimal places: ${human} has ${fraction.length}, expected at most ${decimals}`
    );
  }

  const wholePart = BigInt(whole);
  const factor = 10n ** BigInt(decimals);
  const fractionPart =
    fraction.length > 0 ? BigInt(fraction.padEnd(decimals, "0")) : 0n;

  return wholePart * factor + fractionPart;
}

export function atomicToHuman(atomic: bigint, decimals: number): string {
  if (typeof atomic !== "bigint") {
    throw new TypeError("atomic must be a bigint");
  }

  if (!Number.isInteger(decimals) || decimals < 0) {
    throw new Error("decimals must be a non-negative integer");
  }

  if (atomic < 0n) {
    throw new Error("atomic amount cannot be negative");
  }

  if (decimals === 0) {
    return atomic.toString();
  }

  const factor = 10n ** BigInt(decimals);
  const whole = atomic / factor;
  const remainder = atomic % factor;

  if (remainder === 0n) {
    return whole.toString();
  }

  const fraction = remainder
    .toString()
    .padStart(decimals, "0")
    .replace(/0+$/, "");

  return `${whole}.${fraction}`;
}
