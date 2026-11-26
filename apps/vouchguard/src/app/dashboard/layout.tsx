import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";

import { AccountChip } from "@/components/dashboard/account-chip";
import { SidebarNav } from "@/components/dashboard/sidebar-nav";
import { DemoBanner } from "@/components/demo-banner";
import { Brand } from "@/components/brand";
import { Badge } from "@/components/ui/badge";
import { Toaster } from "@/components/ui/toaster";
import { brand } from "@/lib/brand-config";

/**
 * The dashboard is intentionally reachable without auth: the domain is new and unlisted,
 * and authentication depends on the mandate store (#423/#436). Every route below this
 * layout is noindex, and the account chip is labelled as a demo account.
 */
export const metadata: Metadata = {
  title: { default: "Dashboard", template: `%s — ${brand.name}` },
  description: `${brand.name} dashboard preview. Demo data only; no mandates exist yet.`,
  robots: { index: false, follow: false, nocache: true },
};

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-ink/[0.025]">
      <div className="mx-auto flex min-h-screen w-full max-w-[1500px] flex-col md:flex-row">
        <aside className="shrink-0 border-b border-ink/10 bg-paper md:sticky md:top-0 md:h-screen md:w-60 md:border-b-0 md:border-r">
          <div className="flex items-center justify-between gap-3 px-5 py-4 md:block md:px-5 md:py-6">
            <Brand href="/dashboard" />
            <div className="md:mt-3 md:hidden">
              <Badge variant="secondary">Demo workspace</Badge>
            </div>
          </div>
          <div className="px-3 pb-4 md:px-3">
            <SidebarNav />
          </div>
          <div className="hidden px-5 pb-6 md:block">
            <div className="rounded-lg border border-ink/10 bg-ink/[0.02] p-3">
              <p className="text-xs font-semibold text-ink">Demo workspace</p>
              <p className="mt-1 text-[11px] leading-relaxed text-muted">
                No mandates exist yet. This shell is a preview of the shape.
              </p>
              <Link href="/" className="mt-2 inline-block text-[11px] font-semibold text-deep hover:underline">
                Back to {brand.domain} →
              </Link>
            </div>
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-30 flex h-16 items-center justify-between gap-4 border-b border-ink/10 bg-paper/90 px-5 backdrop-blur sm:px-8">
            <div className="flex items-center gap-2 text-sm">
              <span className="font-semibold text-ink">Dashboard</span>
              <span className="text-muted">·</span>
              <span className="text-muted">preview</span>
            </div>
            <div className="flex items-center gap-3">
              <Badge variant="gold" className="hidden sm:inline-flex">
                Demo data
              </Badge>
              <AccountChip />
            </div>
          </header>

          <main className="flex-1 px-5 py-6 sm:px-8 sm:py-8">
            <div className="mx-auto w-full max-w-5xl">
              <DemoBanner />
              <div className="mt-6">{children}</div>
            </div>
          </main>

          <footer className="border-t border-ink/10 px-5 py-5 text-xs text-muted sm:px-8">
            {brand.name} dashboard preview · no authentication wired up · data is a fixture, not a tenant.
          </footer>
        </div>
      </div>
      <Toaster />
    </div>
  );
}
