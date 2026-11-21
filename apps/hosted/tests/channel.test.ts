import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import {
  CHANNEL_COOKIE,
  CHANNEL_MAX_LENGTH,
  channelFromCookieHeader,
  channelFromUrl,
  channelMiddleware,
  firstTouch,
  normaliseChannel,
} from "../src/channel.js";

describe("normaliseChannel", () => {
  it("lowercases a channel", () => {
    expect(normaliseChannel("Glama")).toBe("glama");
    expect(normaliseChannel("MCP-REGISTRY")).toBe("mcp-registry");
  });

  it("accepts every allowed character", () => {
    expect(normaliseChannel("mcp.so")).toBe("mcp.so");
    expect(normaliseChannel("a_b-c.d")).toBe("a_b-c.d");
    expect(normaliseChannel("123")).toBe("123");
  });

  it(`accepts up to ${CHANNEL_MAX_LENGTH} characters and rejects longer`, () => {
    expect(normaliseChannel("a".repeat(CHANNEL_MAX_LENGTH))).toBe("a".repeat(CHANNEL_MAX_LENGTH));
    expect(normaliseChannel("a".repeat(CHANNEL_MAX_LENGTH + 1))).toBeNull();
  });

  it("rejects empty, absent and invalid values rather than bucketing them", () => {
    for (const bad of ["", "   ", "glama!", "gl ama", "glama/", "https://glama.ai", null, undefined]) {
      expect(normaliseChannel(bad)).toBeNull();
    }
  });
});

describe("channelFromUrl", () => {
  it("reads ?from=", () => {
    expect(channelFromUrl("https://api.paystage.xyz/v1/evaluate_mcp_payment?from=Glama")).toBe("glama");
  });

  it("returns null when the parameter is absent", () => {
    expect(channelFromUrl("https://api.paystage.xyz/v1/evaluate_mcp_payment")).toBeNull();
  });

  it("returns null for an invalid or oversized value", () => {
    expect(channelFromUrl("https://api.paystage.xyz/?from=glama%21")).toBeNull();
    expect(channelFromUrl(`https://api.paystage.xyz/?from=${"a".repeat(33)}`)).toBeNull();
  });

  it("uses the first from when the parameter repeats", () => {
    expect(channelFromUrl("https://api.paystage.xyz/?from=glama&from=mcp.so")).toBe("glama");
  });

  it("returns null instead of throwing on an unparseable URL", () => {
    expect(channelFromUrl("not a url")).toBeNull();
  });
});

describe("firstTouch", () => {
  it("keeps the first valid channel for the session", () => {
    expect(firstTouch("glama", "mcp.so")).toBe("glama");
  });

  it("accepts a channel when the session has none yet", () => {
    expect(firstTouch(null, "mcp.so")).toBe("mcp.so");
    expect(firstTouch(undefined, "Glama")).toBe("glama");
  });

  it("stores null when neither side has a valid channel", () => {
    expect(firstTouch(null, null)).toBeNull();
    expect(firstTouch("bad!", "worse!")).toBeNull();
  });

  it("treats an invalid stored value as no touch, not as a lock", () => {
    expect(firstTouch("bad!", "glama")).toBe("glama");
  });
});

describe("channelFromCookieHeader", () => {
  it("reads the channel cookie among other cookies", () => {
    expect(channelFromCookieHeader(`a=1; ${CHANNEL_COOKIE}=glama; b=2`)).toBe("glama");
  });

  it("returns null when absent or malformed", () => {
    expect(channelFromCookieHeader("a=1; b=2")).toBeNull();
    expect(channelFromCookieHeader(null)).toBeNull();
    expect(channelFromCookieHeader(`${CHANNEL_COOKIE}=bad%21`)).toBeNull();
  });
});

function channelApp() {
  const app = new Hono<{ Variables: { channel: string | null } }>();
  app.use("*", channelMiddleware());
  app.get("/", (c) => c.json({ channel: c.get("channel") }));
  return app;
}

describe("channelMiddleware", () => {
  it("stores the first touch and returns it on later requests from the same session", async () => {
    const app = channelApp();
    const first = await app.request("http://localhost/?from=Glama");
    expect(await first.json()).toEqual({ channel: "glama" });
    const setCookie = first.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain(`${CHANNEL_COOKIE}=glama`);
    expect(setCookie.toLowerCase()).toContain("httponly");

    const second = await app.request("http://localhost/", { headers: { cookie: setCookie.split(";")[0] ?? "" } });
    expect(await second.json()).toEqual({ channel: "glama" });
  });

  it("does not let a later listing overwrite the first touch", async () => {
    const app = channelApp();
    const first = await app.request("http://localhost/?from=glama");
    const cookie = (first.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
    const second = await app.request("http://localhost/?from=mcp.so", { headers: { cookie } });
    expect(await second.json()).toEqual({ channel: "glama" });
    // The winner already came from the session; a weaker later value must not rewrite the cookie either.
    expect(second.headers.get("set-cookie")).toBeNull();
  });

  it("stores null for an absent or invalid parameter and sets no cookie", async () => {
    const app = channelApp();
    for (const url of ["http://localhost/", "http://localhost/?from=glama%21"]) {
      const res = await app.request(url);
      expect(await res.json()).toEqual({ channel: null });
      expect(res.headers.get("set-cookie")).toBeNull();
    }
  });
});
