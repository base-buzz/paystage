import { directoryPayload } from "@/lib/directory";

/**
 * `/directory.json` — the same directory the page renders, for agents.
 *
 * It serves the committed snapshot unchanged. `/directory` reads the same module, and
 * `apps/console/tests/directory.test.ts` asserts the two carry the same rows, so this endpoint cannot drift into a
 * second, more flattering copy.
 */
export const dynamic = "force-static";

export function GET() {
  return new Response(JSON.stringify(directoryPayload(), null, 2), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "public, max-age=300, s-maxage=300",
      "access-control-allow-origin": "*",
    },
  });
}
