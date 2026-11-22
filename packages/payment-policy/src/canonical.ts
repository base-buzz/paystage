/**
 * One canonical serialisation for the policy document.
 *
 * The byte-for-byte round-trip is only meaningful if "the same document" has one spelling.
 * JSON.stringify preserves insertion order and accepts incidental whitespace, so it cannot be
 * the canonical form: two objects with the same fields in different orders would compare as
 * different documents. This sorts object keys by code unit, keeps array order (order is data
 * in `allowed_pay_to` and in the velocity windows), and emits no whitespace.
 */
export function canonicalJson(value: unknown): string {
  if (value === null) return "null";

  switch (typeof value) {
    case "string":
    case "boolean":
      return JSON.stringify(value);
    case "number":
      if (!Number.isFinite(value)) throw new TypeError("canonicalJson: numbers must be finite");
      return JSON.stringify(value);
    case "object":
      break;
    default:
      throw new TypeError(`canonicalJson: ${typeof value} is not representable in JSON`);
  }

  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  }

  const object = value as Record<string, unknown>;
  const parts: string[] = [];
  for (const key of Object.keys(object).sort()) {
    const entry = object[key];
    // undefined is not a JSON value. Dropping it silently would make emit→parse lossy without
    // saying so, which is the one failure this package exists to rule out.
    if (entry === undefined) throw new TypeError(`canonicalJson: field "${key}" is undefined; omit it instead`);
    parts.push(`${JSON.stringify(key)}:${canonicalJson(entry)}`);
  }
  return `{${parts.join(",")}}`;
}
