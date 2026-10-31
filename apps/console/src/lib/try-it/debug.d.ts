export function createDebugLog(): {
  requestId: string;
  lines: Array<Record<string, unknown>>;
  log(step: string, data?: unknown): void;
  toText(): string;
  clear(): void;
};
export function attachDebugPanel(root: HTMLElement, debug: ReturnType<typeof createDebugLog>): unknown;
