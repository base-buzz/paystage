import { handleAsk } from "../../../lib/ask-server";

/**
 * `POST /api/ask` (#511) — the brand site's only write.
 *
 * The route is a thin adapter: the contract, hashing and error mapping live in `lib/ask-server.ts` so
 * they can be tested without a Supabase project. It holds the **anon** key only; the table has no anon
 * grant and the write goes through the security-definer `ask_answer()` function in the migration.
 *
 * `force-dynamic` because an answer is a write and a cached response would be a lie about it.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  return handleAsk(request);
}
