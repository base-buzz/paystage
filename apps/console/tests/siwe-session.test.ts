import { describe, it, expect, beforeAll } from "vitest";
import { privateKeyToAccount } from "viem/accounts";

const TEST_SECRET = "test-secret-please-change-0123456789abcdef";

beforeAll(() => {
  process.env.SIWE_SESSION_SECRET = TEST_SECRET;
});

async function loadSession() {
  return import("../src/lib/siwe/session");
}

async function loadMessage() {
  return import("../src/lib/siwe/message");
}

const TEST_PRIVATE_KEY =
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as const;

function buildMessage(opts: {
  domain: string;
  address: string;
  nonce: string;
  chainId: number;
  issuedAt?: Date;
  expirationTime?: Date;
  statement?: string;
}): string {
  const issuedAt = (opts.issuedAt ?? new Date()).toISOString();
  const lines: string[] = [];
  lines.push(`${opts.domain} wants you to sign in with your Ethereum account:`);
  lines.push(opts.address);
  lines.push("");
  if (opts.statement) {
    lines.push(opts.statement);
    lines.push("");
  }
  lines.push(`URI: https://${opts.domain}/login`);
  lines.push("Version: 1");
  lines.push(`Chain ID: ${opts.chainId}`);
  lines.push(`Nonce: ${opts.nonce}`);
  lines.push(`Issued At: ${issuedAt}`);
  if (opts.expirationTime) {
    lines.push(`Expiration Time: ${opts.expirationTime.toISOString()}`);
  }
  return lines.join("\n");
}

describe("siwe session seal/open", () => {
  it("roundtrips a payload", async () => {
    const { seal, open } = await loadSession();
    const token = await seal("hello-world", 60);
    expect(token.startsWith("v1.")).toBe(true);
    const result = await open(token);
    expect(result).not.toBeNull();
    expect(result!.payload).toBe("hello-world");
    expect(result!.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  it("returns null for expired token", async () => {
    const { seal, open } = await loadSession();
    const token = await seal("expired", -10);
    const result = await open(token);
    expect(result).toBeNull();
  });

  it("returns null for tampered hmac", async () => {
    const { seal, open } = await loadSession();
    const token = await seal("tamper", 60);
    const parts = token.split(".");
    const mac = parts[3]!;
    const flipped = (mac[0] === "A" ? "B" : "A") + mac.slice(1);
    const tampered = [parts[0], parts[1], parts[2], flipped].join(".");
    const result = await open(tampered);
    expect(result).toBeNull();
  });
});

describe("siwe message parsing and validation", () => {
  it("parses a happy path message", async () => {
    const { parseSiweMessage } = await loadMessage();
    const address = "0x0000000000000000000000000000000000000001";
    const msg = buildMessage({
      domain: "console.paystage.xyz",
      address,
      nonce: "abcdef1234567890",
      chainId: 8453,
      statement: "Sign in to PayStage",
    });
    const parsed = parseSiweMessage(msg);
    expect(parsed.domain).toBe("console.paystage.xyz");
    expect(parsed.address).toBe(address);
    expect(parsed.chainId).toBe(8453);
    expect(parsed.nonce).toBe("abcdef1234567890");
    expect(parsed.version).toBe("1");
    expect(parsed.statement).toBe("Sign in to PayStage");
    expect(parsed.uri).toBe("https://console.paystage.xyz/login");
  });

  it("rejects wrong domain, nonce, chainId", async () => {
    const { parseSiweMessage, validateSiweFields } = await loadMessage();
    const address = "0x0000000000000000000000000000000000000001";
    const msg = buildMessage({
      domain: "console.paystage.xyz",
      address,
      nonce: "abcdef1234567890",
      chainId: 8453,
    });
    const parsed = parseSiweMessage(msg);

    expect(() =>
      validateSiweFields(parsed, {
        expectedDomain: "evil.example",
        expectedNonce: "abcdef1234567890",
        expectedChainId: 8453,
      }),
    ).toThrow(/domain/i);

    expect(() =>
      validateSiweFields(parsed, {
        expectedDomain: "console.paystage.xyz",
        expectedNonce: "wrongnonce12345",
        expectedChainId: 8453,
      }),
    ).toThrow(/nonce/i);

    expect(() =>
      validateSiweFields(parsed, {
        expectedDomain: "console.paystage.xyz",
        expectedNonce: "abcdef1234567890",
        expectedChainId: 1,
      }),
    ).toThrow(/chainId/i);
  });
});

describe("siwe signature verification", () => {
  it("recovers the signer address", async () => {
    const { verifySiweSignature } = await loadMessage();
    const account = privateKeyToAccount(TEST_PRIVATE_KEY);
    const msg = buildMessage({
      domain: "console.paystage.xyz",
      address: account.address,
      nonce: "abcdef1234567890",
      chainId: 8453,
    });
    const signature = await account.signMessage({ message: msg });
    const recovered = await verifySiweSignature({ message: msg, signature });
    expect(recovered).toBe(account.address.toLowerCase());
  });

  it("throws on invalid signature", async () => {
    const { verifySiweSignature } = await loadMessage();
    const account = privateKeyToAccount(TEST_PRIVATE_KEY);
    const msg = buildMessage({
      domain: "console.paystage.xyz",
      address: account.address,
      nonce: "abcdef1234567890",
      chainId: 8453,
    });
    const badSig = ("0x" + "11".repeat(65)) as `0x${string}`;
    await expect(
      verifySiweSignature({ message: msg, signature: badSig }),
    ).rejects.toThrow();
  });
});
