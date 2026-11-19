/**
 * The slice of elizaOS's plugin API this package implements, declared locally.
 *
 * Same reason as the n8n package: the framework is the runtime, not a dependency, and pulling its tree into a small gate package
 * would cost more than the gate. If elizaOS changes these shapes, this file is where the mismatch appears.
 */
declare module "@elizaos/core" {
  export interface ActionResult {
    success: boolean;
    text?: string;
    data?: Record<string, unknown>;
  }

  export interface Action {
    name: string;
    similes?: string[];
    description: string;
    validate?: (runtime: unknown, message: unknown) => Promise<boolean>;
    handler: (runtime: unknown, message: unknown, state?: unknown) => Promise<ActionResult>;
    examples?: unknown[];
  }

  export interface Provider {
    name: string;
    get: (runtime: unknown, message: unknown, state?: unknown) => Promise<string>;
  }

  export interface Plugin {
    name: string;
    description: string;
    actions?: Action[];
    providers?: Provider[];
  }
}
