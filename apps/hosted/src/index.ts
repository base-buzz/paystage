import { createApp } from "./app.js";
import type { Bindings } from "./env.js";

export default {
  fetch(request: Request, env: Bindings, ctx: ExecutionContext): Response | Promise<Response> {
    const app = createApp(env);
    return app.fetch(request, env, ctx);
  },
};
