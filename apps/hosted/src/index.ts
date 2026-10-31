import { createApp } from "./app.js";
import type { Bindings } from "./env.js";
import { heartbeatSupabase } from "./telemetry.js";

export default {
  fetch(request: Request, env: Bindings, ctx: ExecutionContext): Response | Promise<Response> {
    const app = createApp(env);
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
