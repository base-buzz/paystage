/**
 * DEMO DATA ONLY.
 *
 * The mandate store does not exist yet (#423/#436), so there is nothing real to render.
 * These fixtures exist to show the shape of the screens. Every route that renders them
 * carries <DemoBanner /> with the exact sentence requested by the brief — do not add a
 * page that shows this file without that banner.
 *
 * The numbers and the name intentionally match the shared pass artwork in
 * apps/console/public/mocks (frame-pass-active / frame-pass-revoked: Grok Bot,
 * $2.00 per purchase, $20.00 per 24h, 31 Jan 2027). A mismatch between the picture and
 * the table beside it is the exact "screenshot implies a different product" failure this
 * app is meant to avoid. If the artwork changes, change these fixtures with it.
 */

export type PassStatus = "active" | "revoked" | "expired";

export interface DemoPass {
  serial: string;
  teammate: string;
  platform: string;
  principal: string;
  perPurchase: string;
  perWindow: string;
  window: string;
  expires: string;
  issued: string;
  payees: string[];
  network: string;
  status: PassStatus;
  statusNote: string;
  tintIndex: number;
  image: string;
}

export const DEMO_PASSES: DemoPass[] = [
  {
    serial: "VG-7F3A-42D1",
    teammate: "Grok Bot",
    platform: "via Grok · research",
    principal: "Northwind Ltd",
    perPurchase: "$2.00",
    perWindow: "$20.00",
    window: "per 24h",
    expires: "31 Jan 2027",
    issued: "14 Nov 2026",
    payees: ["api.vendor-a.example", "fetch.vendor-b.example"],
    network: "Base",
    status: "active",
    statusNote: "within its issued window",
    tintIndex: 1,
    image: "/mocks/frame-pass-active.png",
  },
  {
    serial: "VG-9D27-1E5B",
    teammate: "Grok Bot",
    platform: "via Grok · research",
    principal: "Northwind Ltd",
    perPurchase: "$2.00",
    perWindow: "$20.00",
    window: "per 24h",
    expires: "31 Jan 2027",
    issued: "02 Nov 2026",
    payees: ["api.vendor-a.example", "fetch.vendor-b.example"],
    network: "Base",
    status: "revoked",
    statusNote: "revoked 22 Nov 2026 — replaced by VG-7F3A-42D1",
    tintIndex: 3,
    image: "/mocks/frame-pass-revoked.png",
  },
];

export type Verdict = "pay" | "review" | "do not pay";

export interface DemoActivity {
  id: string;
  at: string;
  day: string;
  serial: string;
  teammate: string;
  payee: string;
  amount: string;
  verdict: Verdict;
  rule: string;
}

export const DEMO_ACTIVITY: DemoActivity[] = [
  {
    id: "a1",
    at: "09:41",
    day: "25 Nov 2026",
    serial: "VG-7F3A-42D1",
    teammate: "Grok Bot",
    payee: "api.vendor-a.example",
    amount: "$0.42",
    verdict: "pay",
    rule: "inside the per-purchase cap",
  },
  {
    id: "a2",
    at: "09:39",
    day: "25 Nov 2026",
    serial: "VG-7F3A-42D1",
    teammate: "Grok Bot",
    payee: "fetch.vendor-b.example",
    amount: "$0.50",
    verdict: "pay",
    rule: "at the per-purchase cap; 8 of 10 daily calls used",
  },
  {
    id: "a3",
    at: "09:12",
    day: "25 Nov 2026",
    serial: "VG-7F3A-42D1",
    teammate: "Grok Bot",
    payee: "status.vendor-c.example",
    amount: "$1.80",
    verdict: "review",
    rule: "payee not on the allowed list",
  },
  {
    id: "a4",
    at: "08:57",
    day: "25 Nov 2026",
    serial: "VG-7F3A-42D1",
    teammate: "Grok Bot",
    payee: "api.vendor-a.example",
    amount: "$0.12",
    verdict: "pay",
    rule: "inside the per-purchase cap",
  },
  {
    id: "a5",
    at: "08:44",
    day: "25 Nov 2026",
    serial: "VG-7F3A-42D1",
    teammate: "Grok Bot",
    payee: "batch.vendor-g.example",
    amount: "$6.00",
    verdict: "do not pay",
    rule: "over the per-purchase cap ($2.00)",
  },
  {
    id: "a6",
    at: "08:20",
    day: "25 Nov 2026",
    serial: "VG-7F3A-42D1",
    teammate: "Grok Bot",
    payee: "search.vendor-h.example",
    amount: "$0.30",
    verdict: "review",
    rule: "spend is 82% of the 24h window",
  },
  {
    id: "a7",
    at: "17:05",
    day: "24 Nov 2026",
    serial: "VG-9D27-1E5B",
    teammate: "Grok Bot",
    payee: "quotes.vendor-d.example",
    amount: "$1.10",
    verdict: "do not pay",
    rule: "pass was revoked before the request",
  },
  {
    id: "a8",
    at: "16:32",
    day: "24 Nov 2026",
    serial: "VG-7F3A-42D1",
    teammate: "Grok Bot",
    payee: "fetch.vendor-b.example",
    amount: "$0.48",
    verdict: "pay",
    rule: "inside the per-purchase cap",
  },
];

export const DEMO_SETTINGS = {
  principal: "Northwind Ltd",
  verificationBase: "https://vouchguard.app",
  defaultPerPurchase: "2.00",
  defaultPerWindow: "20.00",
  defaultExpiry: "2027-01-31",
  issuerLine: "vouched by PayStage",
};

export function passBySerial(serial: string): DemoPass | undefined {
  return DEMO_PASSES.find((pass) => pass.serial.toLowerCase() === serial.toLowerCase());
}

export function activityForSerial(serial: string): DemoActivity[] {
  return DEMO_ACTIVITY.filter((row) => row.serial.toLowerCase() === serial.toLowerCase());
}
