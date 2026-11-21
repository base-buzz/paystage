import { describe, it, expect, vi, afterEach } from "vitest";
import { recordEvent } from "../src/telemetry.js";

/**
 * #360. The retry that was written for the failure that still happened.
 *
 * PostgREST answers a missing column with HTTP 400 and a body whose `code` comes BEFORE
 * `message`:
 *
 *   {"code":"PGRST204","details":null,"hint":null,
 *    "message":"Could not find the 'channel' column of 'events' in the schema cache"}
 *
 * The writer has to read the column name out of that body, drop only that field, and POST
 * again. The stub below reproduces the real ordering (code first) and the real status (400),
 * which is exactly what the old parser got wrong: it matched the code and stopped before the
 * message that names the column.
 *
 * Two assertions are the point of the exercise: a row still LANDS, and the retried payload
 * omits only the named column.
 */

const EVENT = {
  source: "real" as const,
  tool: "evaluate_mcp_payment",
  decision: "allow",
  reason_codes: [] as string[],
  network: "eip155:8453",
  payer: "0x0000000000000000000000000000000000000002",
  channel: "glama",
  request_id: "rid-360",
  latency_ms: 12,
};

function postgrestMissingColumn(field: string): string {
  return JSON.stringify({
    code: "PGRST204",
    details: null,
    hint: null,
    message: `Could not find the '${field}' column of 'events' in the schema cache`,
  });
}

/**
 * A stub of the events table before its migration: the first insert is rejected with
 * PGRST204 naming `field`, the retried insert returns 201 and the row lands.
 */
function stubTableMissing(field: string) {
  const posts: Record<string, unknown>[] = [];
  const rows: Record<string, unknown>[] = [];
  const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    posts.push(body);
    if (posts.length === 1) {
      return new Response(postgrestMissingColumn(field), {
        status: 400,
        headers: { "content-type": "application/json" },
      });
    }
    rows.push(body);
    return new Response(null, { status: 201 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock, posts, rows };
}

async function run(event: typeof EVENT = EVENT): Promise<void> {
  const waits: Promise<unknown>[] = [];
  recordEvent(
    { SUPABASE_URL: "https://example.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "service-role" },
    event,
    (p) => waits.push(p),
  );
  await Promise.all(waits);
}

function loggedLines(log: { mock: { calls: unknown[][] } }): Array<Record<string, unknown>> {
  return log.mock.calls
    .map((call) => String(call[0]))
    .filter((line) => line.startsWith("{"))
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("#360 telemetry PGRST204 retry", () => {
  it.each(["payer", "channel"] as const)(
    "a PGRST204 for %s drops only that column and a row still lands",
    async (field) => {
      const log = vi.spyOn(console, "log").mockImplementation(() => {});
      const { fetchMock, posts, rows } = stubTableMissing(field);

      await run();

      // The whole failure: today the writer gives up after one POST, so this is 1 and rows is 0.
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(rows).toHaveLength(1);

      const first = posts[0]!;
      const retried = posts[1]!;
      expect(first).toHaveProperty(field);

      // The retry omits the named column and nothing else.
      expect(retried).not.toHaveProperty(field);
      const expected = Object.fromEntries(Object.entries(first).filter(([k]) => k !== field));
      expect(retried).toEqual(expected);

      // The drop is loud: it names the column and says the migration is missing.
      const drop = loggedLines(log).find((line) => line.msg === "telemetry_field_dropped");
      expect(drop).toBeDefined();
      expect(drop?.field).toBe(field);
      expect(String(drop?.note ?? "")).toMatch(/migration/i);
      expect(String(drop?.note ?? "")).toContain(field);
    },
  );

  it("does not drop a column off the allowlist, and keeps the PostgREST body in the log", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const { fetchMock, posts } = stubTableMissing("tool_v2");

    await run();

    // Guessing with an unknown field is not allowed: one attempt, no drop, no retry.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(posts).toHaveLength(1);

    // The rejection is diagnosable from the logs alone. The old code consumed the 400 body in
    // the drop check, then logged an empty `body` for the failure, which is how a missing
    // column stayed invisible even to someone reading the logs.
    const rejected = loggedLines(log).find((line) => line.msg === "telemetry_insert_rejected");
    expect(rejected).toBeDefined();
    expect(String(rejected?.body ?? "")).toContain("tool_v2");
    expect(String(rejected?.body ?? "")).toContain("PGRST204");
  });
});
