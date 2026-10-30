#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  EvaluateVelocityInputSchema,
  evaluateVelocity,
  serializeVelocityResult,
} from "./mcp.js";

const server = new McpServer({
  name: "paystage-velocity",
  version: "0.1.0",
});

server.registerTool(
  "evaluate_velocity",
  {
    title: "Evaluate velocity",
    description:
      "Rolling-window rate and spend-pattern check for a proposed payment against history and a policy.",
    inputSchema: EvaluateVelocityInputSchema,
  },
  async (input) => {
    const result = await evaluateVelocity(input);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(serializeVelocityResult(result), null, 2),
        },
      ],
    };
  },
);

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
