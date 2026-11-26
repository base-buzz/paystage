import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Ban, Clock3, KeyRound, ShieldAlert } from "lucide-react";

import { StatusBadge } from "@/components/dashboard/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { DEMO_PASSES, activityForSerial, passBySerial, type Verdict } from "@/lib/demo-data";

export function generateStaticParams() {
  return DEMO_PASSES.map((pass) => ({ serial: pass.serial }));
}

export async function generateMetadata({ params }: { params: Promise<{ serial: string }> }): Promise<Metadata> {
  const { serial } = await params;
  const pass = passBySerial(serial);
  return {
    title: pass ? `${pass.serial} · ${pass.teammate}` : "Unknown pass",
    robots: { index: false, follow: false, nocache: true },
  };
}

const VERDICT_VARIANT: Record<Verdict, "active" | "gold" | "revoked"> = {
  pay: "active",
  review: "gold",
  "do not pay": "revoked",
};

export default async function PassDetailPage({ params }: { params: Promise<{ serial: string }> }) {
  const { serial } = await params;
  const pass = passBySerial(serial);

  if (!pass) notFound();

  const activity = activityForSerial(pass.serial);

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/dashboard"
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-muted hover:text-ink"
        >
          <ArrowLeft aria-hidden="true" className="h-3.5 w-3.5" />
          All passes
        </Link>
        <div className="mt-3 flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
          <div>
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="font-mono text-xl font-bold tracking-tight text-ink sm:text-2xl">{pass.serial}</h1>
              <StatusBadge status={pass.status} />
            </div>
            <p className="mt-1 text-sm text-ink/60">
              {pass.teammate} · {pass.platform} · principal {pass.principal}
            </p>
          </div>
          <p className="max-w-xs text-right text-xs leading-relaxed text-muted">{pass.statusNote}</p>
        </div>
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
        <Card className="overflow-hidden">
          <div className="bg-tint-1/10 p-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={pass.image}
              alt={`The ${pass.teammate} pass face: ${pass.perPurchase} per purchase, ${pass.perWindow} ${pass.window}.`}
              width={750}
              height={1035}
              className="pass-shadow w-full rounded-xl border border-ink/10"
            />
          </div>
          <CardContent className="p-4">
            <p className="text-[11px] leading-relaxed text-muted">
              Illustrative Wallet asset from the shared renderer. The plain card is the pass; the phone frame is not a
              claim about a live integration.
            </p>
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Limits</CardTitle>
              <CardDescription>What the mandate authorises, as it would be shown on the pass.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="rounded-lg border border-ink/10 bg-ink/[0.02] p-3">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-muted">Per purchase</p>
                  <p className="mt-1 text-2xl font-bold text-ink">{pass.perPurchase}</p>
                </div>
                <div className="rounded-lg border border-ink/10 bg-ink/[0.02] p-3">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-muted">Per 24h window</p>
                  <p className="mt-1 text-2xl font-bold text-ink">
                    {pass.perWindow}
                    <span className="ml-1 text-xs font-medium text-muted">{pass.window}</span>
                  </p>
                </div>
              </div>

              <Separator />

              <dl className="grid gap-3 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-[10px] font-semibold uppercase tracking-wider text-muted">Expires</dt>
                  <dd className="mt-0.5 text-ink">{pass.expires}</dd>
                </div>
                <div>
                  <dt className="text-[10px] font-semibold uppercase tracking-wider text-muted">Issued</dt>
                  <dd className="mt-0.5 text-ink">{pass.issued}</dd>
                </div>
                <div>
                  <dt className="text-[10px] font-semibold uppercase tracking-wider text-muted">Network</dt>
                  <dd className="mt-0.5 text-ink">{pass.network}</dd>
                </div>
                <div>
                  <dt className="text-[10px] font-semibold uppercase tracking-wider text-muted">Issuer line</dt>
                  <dd className="mt-0.5 text-ink">vouched by PayStage</dd>
                </div>
              </dl>

              <Separator />

              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted">Allowed payees</p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {pass.payees.map((payee) => (
                    <Badge key={payee} variant="outline" className="font-mono text-[10px] font-medium">
                      {payee}
                    </Badge>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-red/20">
            <CardHeader>
              <div className="flex items-center gap-2">
                <ShieldAlert aria-hidden="true" className="h-4 w-4 text-red" />
                <CardTitle className="text-base">Revoke this pass</CardTitle>
              </div>
              <CardDescription>
                A revoke is a signed statement, not a UI toggle: it has to be visible on the next scan and to the
                seller. The control is rendered here on purpose.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div id="revoke-reason" className="rounded-lg border border-ink/10 bg-ink/[0.02] p-3 text-xs leading-relaxed text-ink/70">
                <span className="font-semibold text-ink">Disabled in this preview.</span> Revoking writes a signed
                statement to the mandate store, which does not exist yet (#423/#436). No request is sent from this
                button.
              </div>
              <Button variant="destructive" disabled aria-describedby="revoke-reason" className="w-full sm:w-auto">
                <Ban aria-hidden="true" />
                Revoke pass
              </Button>
              <p className="flex items-center gap-1.5 text-[11px] text-muted">
                <Clock3 aria-hidden="true" className="h-3 w-3" />
                No-op control — state is not changed anywhere.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle className="text-base">Activity</CardTitle>
            <CardDescription>Requests the gate would have judged for this serial.</CardDescription>
          </div>
          <Badge variant="secondary" className="gap-1">
            <KeyRound aria-hidden="true" className="h-3 w-3" />
            {activity.length} fixture{activity.length === 1 ? "" : "s"}
          </Badge>
        </CardHeader>
        <CardContent className="px-0 pb-0">
          {activity.length === 0 ? (
            <p className="px-6 py-8 text-sm text-muted">No fixture rows for this serial.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-6">When</TableHead>
                  <TableHead>Payee</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Verdict</TableHead>
                  <TableHead className="hidden pr-6 md:table-cell">Rule</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {activity.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="pl-6">
                      <span className="block text-sm text-ink">{row.at}</span>
                      <span className="block text-[11px] text-muted">{row.day}</span>
                    </TableCell>
                    <TableCell className="font-mono text-xs text-ink/80">{row.payee}</TableCell>
                    <TableCell className="text-sm tabular-nums text-ink">{row.amount}</TableCell>
                    <TableCell>
                      <Badge variant={VERDICT_VARIANT[row.verdict]}>{row.verdict}</Badge>
                    </TableCell>
                    <TableCell className="hidden pr-6 text-xs text-muted md:table-cell">{row.rule}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
