import type { Metadata } from "next";
import { Link2, Lock, Settings2, ShieldCheck } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { DEMO_SETTINGS } from "@/lib/demo-data";

export const metadata: Metadata = { title: "Settings" };

export default function SettingsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-ink">Settings</h1>
        <p className="mt-1 text-sm text-ink/60">
          Defaults for new passes and the public verification line. These values are fixtures until the mandate store
          exists, so the form is rendered read-only.
        </p>
      </div>

      <form className="space-y-6" aria-describedby="settings-readonly">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Settings2 aria-hidden="true" className="h-4 w-4 text-deep" />
                <CardTitle className="text-base">Pass defaults</CardTitle>
              </div>
              <Badge variant="secondary">Preview</Badge>
            </div>
            <CardDescription>New passes start from these numbers; every one is editable at issue time.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-5 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="principal">Principal display name</Label>
              <Input id="principal" name="principal" defaultValue={DEMO_SETTINGS.principal} autoComplete="off" />
              <p className="text-[11px] text-muted">Shown on the pass face as the principal.</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="issuer">Issuer line</Label>
              <Input id="issuer" name="issuer" defaultValue={DEMO_SETTINGS.issuerLine} readOnly aria-readonly="true" />
              <p className="text-[11px] text-muted">Fixed: PayStage is the issuer, not the brand on the pass.</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="per-purchase">Default per-purchase cap (USD)</Label>
              <Input
                id="per-purchase"
                name="per-purchase"
                type="text"
                inputMode="decimal"
                defaultValue={DEMO_SETTINGS.defaultPerPurchase}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="per-window">Default per-24h cap (USD)</Label>
              <Input
                id="per-window"
                name="per-window"
                type="text"
                inputMode="decimal"
                defaultValue={DEMO_SETTINGS.defaultPerWindow}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="expiry">Default expiry</Label>
              <Input id="expiry" name="expiry" type="date" defaultValue={DEMO_SETTINGS.defaultExpiry} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="window">Rolling window</Label>
              <Input id="window" name="window" defaultValue="24h" readOnly aria-readonly="true" />
              <p className="text-[11px] text-muted">
                A windowed cap, not a lifetime allowance — the policy schema has no total.
              </p>
            </div>
          </CardContent>
          <div className="flex flex-wrap items-center gap-3 border-t border-ink/10 px-6 py-4">
            <Button type="submit" disabled aria-describedby="settings-readonly">
              <Lock aria-hidden="true" />
              Save changes
            </Button>
            <p id="settings-readonly" className="text-[11px] text-muted">
              Disabled: there is nowhere to persist these values yet (#423/#436).
            </p>
          </div>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Link2 aria-hidden="true" className="h-4 w-4 text-deep" />
              <CardTitle className="text-base">Verification</CardTitle>
            </div>
            <CardDescription>The public page a pass QR points at, and the three states it can return.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="verification-base">Verification base URL</Label>
              <Input
                id="verification-base"
                name="verification-base"
                defaultValue={DEMO_SETTINGS.verificationBase}
                readOnly
                aria-readonly="true"
              />
              <p className="text-[11px] text-muted">
                A serial appended to this base is the only verification URL the pass carries.
              </p>
            </div>
            <Separator />
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="active">active</Badge>
              <Badge variant="revoked">revoked</Badge>
              <Badge variant="expired">expired</Badge>
              <span className="text-[11px] text-muted">Same three states on the pass, the page and the API.</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <ShieldCheck aria-hidden="true" className="h-4 w-4 text-deep" />
              <CardTitle className="text-base">Authentication</CardTitle>
            </div>
            <CardDescription>Not implemented in this build.</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm leading-relaxed text-ink/70">
              The dashboard is reachable without sign-in on purpose for now: the domain is unlisted and the operator
              knows. Auth is the next step and depends on the mandate store (#423/#436); until then every route here
              is <span className="font-mono text-xs">noindex</span>.
            </p>
          </CardContent>
        </Card>
      </form>
    </div>
  );
}
