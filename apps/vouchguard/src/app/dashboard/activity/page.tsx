import type { Metadata } from "next";
import Link from "next/link";
import { Activity } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { DEMO_ACTIVITY, type Verdict } from "@/lib/demo-data";

export const metadata: Metadata = { title: "Activity" };

const VERDICT_VARIANT: Record<Verdict, "active" | "gold" | "revoked"> = {
  pay: "active",
  review: "gold",
  "do not pay": "revoked",
};

export default function ActivityPage() {
  const counts = {
    pay: DEMO_ACTIVITY.filter((row) => row.verdict === "pay").length,
    review: DEMO_ACTIVITY.filter((row) => row.verdict === "review").length,
    block: DEMO_ACTIVITY.filter((row) => row.verdict === "do not pay").length,
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-ink">Activity</h1>
        <p className="mt-1 text-sm text-ink/60">
          Every request the gate judged, newest first. A refusal carries the rule that fired — a bare “outside policy”
          would be a support ticket, not an answer.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <Badge variant="active">{counts.pay} pay</Badge>
        <Badge variant="gold">{counts.review} review</Badge>
        <Badge variant="revoked">{counts.block} do not pay</Badge>
        <Badge variant="secondary" className="gap-1">
          <Activity aria-hidden="true" className="h-3 w-3" />
          {DEMO_ACTIVITY.length} fixture rows
        </Badge>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Judgements</CardTitle>
          <CardDescription>
            Amounts, payees and verdicts are demo fixtures. No endpoint produced this table.
          </CardDescription>
        </CardHeader>
        <CardContent className="px-0 pb-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-6">When</TableHead>
                <TableHead>Pass</TableHead>
                <TableHead>Payee</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead>Verdict</TableHead>
                <TableHead className="hidden pr-6 lg:table-cell">Rule</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {DEMO_ACTIVITY.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="pl-6">
                    <span className="block text-sm text-ink">{row.at}</span>
                    <span className="block text-[11px] text-muted">{row.day}</span>
                  </TableCell>
                  <TableCell>
                    <Link
                      href={`/dashboard/passes/${row.serial}`}
                      className="font-mono text-[11px] font-semibold text-deep hover:underline"
                    >
                      {row.serial}
                    </Link>
                    <span className="mt-0.5 block text-[11px] text-muted">{row.teammate}</span>
                  </TableCell>
                  <TableCell className="font-mono text-xs text-ink/80">{row.payee}</TableCell>
                  <TableCell className="text-sm tabular-nums text-ink">{row.amount}</TableCell>
                  <TableCell>
                    <Badge variant={VERDICT_VARIANT[row.verdict]}>{row.verdict}</Badge>
                  </TableCell>
                  <TableCell className="hidden pr-6 text-xs text-muted lg:table-cell">{row.rule}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
