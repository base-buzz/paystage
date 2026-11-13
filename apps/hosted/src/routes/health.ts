import { Hono } from "hono";

export const healthRoutes = new Hono();

/**
 * `/health` answers two questions, and the second one is the reason this is not just `{ok:true}`.
 *
 * On 2026-11-13 the site showed zero events for a day while every request returned 200. The write
 * to Supabase was failing inside a `catch` that logs a warning nobody tails, so "the product is
 * down" and "the telemetry pipe is unplugged" looked identical from outside.
 *
 * Booleans only. A secret's presence is a fact worth publishing; its value never is.
 */
healthRoutes.get("/health", (c) => {
  const env = c.env as { SUPABASE_URL?: string; SUPABASE_SERVICE_ROLE_KEY?: string } | undefined;
  const url = Boolean(env?.SUPABASE_URL);
  const key = Boolean(env?.SUPABASE_SERVICE_ROLE_KEY);

  return c.json({
    ok: true,
    telemetry: {
      // Both are required for a write to happen; reporting them separately says which one to set.
      url,
      key,
      configured: url && key,
    },
  });
});
