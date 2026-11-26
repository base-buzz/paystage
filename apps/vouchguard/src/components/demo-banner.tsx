import { AlertTriangle } from "lucide-react";

/**
 * One banner, one file. Every dashboard route renders it from the dashboard layout, so a
 * new page cannot quietly show fixtures as if they were tenant data.
 *
 * The sentence is fixed by the brief. Do not paraphrase it at a call site.
 */
export const DEMO_BANNER_TEXT =
  "Demo data — no mandates exist yet; this screen is a preview of the shape.";

export function DemoBanner() {
  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="demo-banner"
      className="flex items-start gap-3 rounded-lg border border-gold/50 bg-gold/10 px-4 py-3 text-sm text-ink"
    >
      <AlertTriangle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
      <p className="font-medium">{DEMO_BANNER_TEXT}</p>
    </div>
  );
}
