export type {
  PaymentRequest,
  AcceptOption,
  PaymentResource,
} from "./evaluate.js";
import type {
  PaymentRequest,
  AcceptOption,
  PaymentResource,
} from "./evaluate.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseJsonText(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("content text is not valid JSON");
  }
}

function coerceResource(raw: unknown): PaymentResource | undefined {
  if (!isRecord(raw)) return undefined;
  if (typeof raw.url !== "string") return undefined;
  return {
    url: raw.url,
    description:
      typeof raw.description === "string" ? raw.description : undefined,
    mimeType: typeof raw.mimeType === "string" ? raw.mimeType : undefined,
  };
}

function coerceAccept(raw: Record<string, unknown>): AcceptOption {
  const amount =
    typeof raw.amount === "string"
      ? raw.amount
      : typeof raw.maxAmountRequired === "string"
        ? raw.maxAmountRequired
        : undefined;
  if (
    typeof raw.scheme !== "string" ||
    typeof raw.network !== "string" ||
    typeof amount !== "string" ||
    typeof raw.asset !== "string" ||
    typeof raw.payTo !== "string" ||
    typeof raw.maxTimeoutSeconds !== "number"
  ) {
    throw new Error("malformed accept option");
  }
  return {
    scheme: raw.scheme,
    network: raw.network,
    amount,
    asset: raw.asset,
    payTo: raw.payTo,
    maxTimeoutSeconds: raw.maxTimeoutSeconds,
    extra: isRecord(raw.extra) ? raw.extra : undefined,
  };
}

function coercePaymentRequired(candidate: unknown): PaymentRequest {
  if (!isRecord(candidate)) {
    throw new Error("PaymentRequired must be an object");
  }
  if (candidate.x402Version !== 2) {
    throw new Error(
      `x402Version must be 2, got ${String(candidate.x402Version)}`,
    );
  }
  if (!Array.isArray(candidate.accepts)) {
    throw new Error("accepts must be an array");
  }
  const accepts = candidate.accepts.map((item, i) => {
    if (!isRecord(item)) throw new Error(`accepts[${i}] must be an object`);
    return coerceAccept(item);
  });
  return {
    x402Version: 2,
    accepts,
    error: typeof candidate.error === "string" ? candidate.error : undefined,
    resource: coerceResource(candidate.resource),
  };
}

export function normalizePaymentRequired(input: unknown): PaymentRequest {
  if (!isRecord(input)) {
    throw new Error("payment required input must be an object");
  }
  if ("x402Version" in input && "accepts" in input) {
    return coercePaymentRequired(input);
  }
  if ("structuredContent" in input) {
    return coercePaymentRequired(input.structuredContent);
  }
  if (Array.isArray(input.content)) {
    const textItem = input.content.find(
      (c) => isRecord(c) && c.type === "text" && typeof c.text === "string",
    );
    if (!textItem || !isRecord(textItem) || typeof textItem.text !== "string") {
      throw new Error(
        "MCP tool result content array did not include a text JSON payload",
      );
    }
    return coercePaymentRequired(parseJsonText(textItem.text));
  }
  throw new Error("Unrecognized PaymentRequired input shape");
}
