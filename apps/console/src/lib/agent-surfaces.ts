import surfaces from "../../../../docs/state/agent-surfaces.json";

/**
 * The Discovery section reads the exact JSON the reachability probe writes, so the page and
 * `node scripts/check-agent-surfaces.mjs` cannot disagree about a row. The file is generated;
 * edit the roster in the probe, not here.
 */
export type AgentSurfaceState = "reachable" | "documented-not-listed" | "no-mcp" | "unverified";

export type AgentSurfaceSource = {
  url: string;
  title: string;
  updated: string | null;
  ok: boolean;
  detail: string;
};

export type AgentSurfaceProduct = {
  id: string;
  product: string;
  vendor: string;
  category: string;
  traits: string[];
  what: string;
  state: AgentSurfaceState;
  reason: string;
  checkedAt: string;
  sources: AgentSurfaceSource[];
  note: string | null;
};

type AgentSurfaces = {
  schemaVersion: number;
  generatedAt: string;
  checkedOn: string;
  method: string;
  endpoint: {
    url: string;
    ok: boolean;
    status: number | null;
    checkedAt: string;
    serverName: string | null;
    protocolVersion: string | null;
    detail: string;
  };
  requestBudget: { limit: number; used: number };
  states: Record<AgentSurfaceState, string>;
  counts: Record<AgentSurfaceState, number>;
  products: AgentSurfaceProduct[];
};

export const AGENT_SURFACES = surfaces as AgentSurfaces;

export const AGENT_SURFACE_LABELS: Record<AgentSurfaceState, string> = {
  reachable: "Reachable",
  "documented-not-listed": "Documented, not listed",
  "no-mcp": "No external MCP",
  unverified: "Unverified",
};

export const AGENT_CATEGORIES = [
  {
    id: "persistent",
    label: "Persistent / always-on agents",
    blurb: "They run in the background on routines and triggers, unlike a chat tab that only answers when you type.",
  },
  {
    id: "computer-use",
    label: "Computer-use / cloud-computer agents",
    blurb: "Each operates its own VM with a browser and login sessions, so work keeps going after the window closes.",
  },
  {
    id: "teammate",
    label: "AI teammates",
    blurb: "Named bots with roles that message you, hand work to each other, and come back for a decision.",
  },
  {
    id: "chatbot",
    label: "Chatbots — not this list",
    blurb: "The Q&A interfaces these products are not. A chat tab has no routine, no standing browser session and no teammate to hand work to.",
  },
] as const;
