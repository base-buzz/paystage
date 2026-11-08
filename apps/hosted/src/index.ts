import { createApp } from "./app.js";
import type { Bindings } from "./env.js";
import { heartbeatSupabase } from "./telemetry.js";

/**
 * One app per isolate, not one per request.
 *
 * `createApp()` builds the x402 middleware, which constructs the resource server
 * and calls `facilitatorClient.getSupported()` — a real round trip to the CDP
 * facilitator. Rebuilding it per request paid that cost on every call: measured
 * at ~220 ms of server time for an unpaid 402 from a warm isolate (2026-11-09).
 *
 * The Workers runtime serialises requests within an isolate and `env` is stable
 * for a deployment, so caching on env identity is safe. Tests construct their own
 * apps through `createApp` and are unaffected.
 */
let cached: { env: Bindings; app: ReturnType<typeof createApp> } | undefined;

function appFor(env: Bindings): ReturnType<typeof createApp> {
  if (cached?.env === env) return cached.app;
  const app = createApp(env);
  cached = { env, app };
  return app;
}

export default {
  fetch(request: Request, env: Bindings, ctx: ExecutionContext): Response | Promise<Response> {
    const app = appFor(env);
    return app.fetch(request, env, ctx);
  },
  scheduled(
    _controller: ScheduledController,
    env: Bindings,
    ctx: ExecutionContext,
  ): void {
    ctx.waitUntil(heartbeatSupabase(env).then(() => undefined));
  },
};
