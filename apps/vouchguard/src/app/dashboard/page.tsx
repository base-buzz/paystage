import type { Metadata } from "next";
import Link from "next/link";
import { ArrowUpRight, Plus, WalletCards } from "lucide-react";

import { StatusBadge } from "@/components/dashboard/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { DEMO_PASSES } from "@/lib/demo-data";

export const metadata: Metadata = { title: "Passes" };

export default function PassesPage() {
  const active = DEMO_PASSES.filter((pass) => pass.status === "active").length;
  const revoked = DEMO_PASSES.filter((pass) => pass.status === "revoked").length;

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-ink">Passes</h1>
          <p className="mt-1 text-sm text-ink/60">
            Every pass is a mandate on a card. Open one to read its limits and its activity.
          </p>
        </div>
        <div className="text-right">
          <Button disabled title="Issuing is disabled until the mandate store exists (#423/#436).">
            <Plus aria-hidden="true" />
            Issue a pass
          </Button>
          <p className="mt-1.5 max-w-[16rem] text-[11px] leading-snug text-muted">
            Issuing is disabled until the mandate store exists (#423/#436).
          </p>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Active passes</CardDescription>
            <CardTitle className="text-3xl">{active}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted">of {DEMO_PASSES.length} demo passes</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Revoked</CardDescription>
            <CardTitle className="text-3xl">{revoked}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted">a revoke is terminal and visible on a scan</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Fixture passes</CardDescription>
            <CardTitle className="text-3xl">{DEMO_PASSES.length}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted">no live tenants are shown</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle className="text-base">All passes</CardTitle>
            <CardDescription>Two fixtures: one active and one revoked, matching the shared pass artwork.</CardDescription>
          </div>
          <Badge variant="secondary" className="gap-1">
            <WalletCards aria-hidden="true" className="h-3 w-3" />
            Preview
          </Badge>
        </CardHeader>
        <CardContent className="px-0 pb-0">
          {/* Mobile: cards, because a five-column table at 375px wraps the serial one character at a time. */}
          <ul className="divide-y divide-ink/10 md:hidden">
            {DEMO_PASSES.map((pass) => (
              <li key={pass.serial} className="px-4 py-4">
                <Link href={`/dashboard/passes/${pass.serial}`} className="block no-underline">
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-mono text-xs font-semibold text-deep">{pass.serial}</span>
                    <StatusBadge status={pass.status} />
                  </div>
                  <p className="mt-1 text-sm font-medium text-ink">{pass.teammate}</p>
                  <p className="text-[11px] text-muted">{pass.platform}</p>
                  <p className="mt-2 text-xs text-ink/70">
                    {pass.perPurchase} each purchase · {pass.perWindow} {pass.window} · expires {pass.expires}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
          <div className="hidden md:block">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-6">Pass</TableHead>
                <TableHead>Limits</TableHead>
                <TableHead>Expires</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="pr-6 text-right">
                  <span className="sr-only">Open</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {DEMO_PASSES.map((pass) => (
                <TableRow key={pass.serial}>
                  <TableCell className="pl-6">
                    <Link href={`/dashboard/passes/${pass.serial}`} className="group block no-underline">
                      <span className="block font-mono text-xs font-semibold text-deep group-hover:underline">
                        {pass.serial}
                      </span>
                      <span className="mt-0.5 block text-sm font-medium text-ink">{pass.teammate}</span>
                      <span className="block text-[11px] text-muted">{pass.platform}</span>
                    </Link>
                  </TableCell>
                  <TableCell>
                    <span className="block text-sm text-ink">{pass.perPurchase} each purchase</span>
                    <span className="block text-xs text-muted">
                      {pass.perWindow} {pass.window}
                    </span>
                  </TableCell>
                  <TableCell className="text-sm text-ink/70">{pass.expires}</TableCell>
                  <TableCell>
                    <StatusBadge status={pass.status} />
                  </TableCell>
                  <TableCell className="pr-6 text-right">
                    <Link
                      href={`/dashboard/passes/${pass.serial}`}
                      className="inline-flex items-center gap-1 text-xs font-semibold text-deep hover:underline"
                    >
                      Open <ArrowUpRight aria-hidden="true" className="h-3.5 w-3.5" />
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
