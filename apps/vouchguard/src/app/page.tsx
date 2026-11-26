import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  Ban,
  Coins,
  FileCheck2,
  Fingerprint,
  GitFork,
  ShieldCheck,
  Truck,
  Wallet,
} from "lucide-react";

import { Brand } from "@/components/brand";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { brand, view } from "@/lib/brand-config";
import { posterTints } from "@/lib/tokens";

export const metadata: Metadata = {
  title: view.title,
  description:
    "A wallet pass that shows what an AI agent may spend: per-purchase cap, per-24h cap, expiry and revocation. Not a card, not a wallet, not escrow. vouched by PayStage.",
  alternates: { canonical: view.homepage },
  robots: { index: true, follow: true },
};

const STEPS = [
  {
    n: "1",
    title: "Pick the job",
    surface: "iPhone · Safari",
    body: "Four presets, each already carrying a limit. Picking one only opens the next screen — nothing is issued here.",
    image: "/mocks/story1-pick.png",
    alt: "Safari on an iPhone: four job presets with their spending limits.",
    tint: posterTints[0],
  },
  {
    n: "2",
    title: "Configure the numbers",
    surface: "iPhone · Safari",
    body: "Every number is editable, which is the difference between a preset and a policy: the human changes what they mean.",
    image: "/mocks/story1-configure.png",
    alt: "Safari on an iPhone: editable fields for per-purchase cap, per-24h cap, expiry and payees.",
    tint: posterTints[1],
  },
  {
    n: "3",
    title: "Read back, then Face ID",
    surface: "iPhone · iOS system sheet",
    body: "The read-back comes first: what is granted, in numbers. Only then does iOS draw its own biometric sheet.",
    image: "/mocks/story1-confirm.png",
    alt: "Safari on an iPhone: a read-back of the limits above an iOS Face ID sheet.",
    tint: posterTints[2],
  },
  {
    n: "4",
    title: "Hand it to Wallet",
    surface: "iPhone · Safari → Wallet",
    body: "The pass is signed and handed to the Wallet app. After this transition the page holds nothing; the wallet does.",
    image: "/mocks/story1-provision.png",
    alt: `Safari on an iPhone: an Add to Apple Wallet button for a signed ${brand.name} pass.`,
    tint: posterTints[3],
  },
] as const;

const CANNOT = [
  {
    icon: Ban,
    title: "Tap to pay",
    body: "No chip, no card number, no network mark. A pass cannot move money at a terminal.",
  },
  {
    icon: Coins,
    title: "Hold funds",
    body: "It records a mandate. The money stays in the wallet or account that signs, not in the pass.",
  },
  {
    icon: Truck,
    title: "Verify delivery",
    body: "It can say what an agent was authorised to spend. It cannot say a seller shipped anything.",
  },
] as const;

export default function HomePage() {
  return (
    <div className="min-h-screen bg-paper">
      <header className="sticky top-0 z-40 border-b border-ink/10 bg-paper/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-6">
          <Brand showIssuer />
          <nav aria-label="Primary" className="hidden items-center gap-7 text-sm font-medium text-ink/75 md:flex">
            <a className="hover:text-ink" href="#how-it-works">
              How it works
            </a>
            <a className="hover:text-ink" href="#cannot">
              Limits
            </a>
            <a className="hover:text-ink" href="#hosted-or-fork">
              Hosted or fork
            </a>
          </nav>
          <div className="flex items-center gap-2">
            <Button asChild variant="ghost" size="sm" className="hidden sm:inline-flex">
              <Link href="/dashboard">Dashboard</Link>
            </Button>
            <Button asChild size="sm">
              <a href="#how-it-works">
                See the pass <ArrowRight aria-hidden="true" />
              </a>
            </Button>
          </div>
        </div>
      </header>

      <main id="main">
        {/* Hero: the pass face, large, with one line of copy. */}
        <section className="relative overflow-hidden border-b border-ink/10">
          <div aria-hidden="true" className="paper-grid absolute inset-0 opacity-60" />
          <div
            aria-hidden="true"
            className="absolute -right-40 -top-40 h-[34rem] w-[34rem] rounded-full bg-brand/10 blur-3xl"
          />
          <div className="relative mx-auto grid max-w-6xl items-center gap-14 px-6 py-16 lg:grid-cols-[1.05fr_0.95fr] lg:py-24">
            <div>
              <p className="inline-flex items-center gap-2 rounded-full border border-ink/10 bg-paper px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted">
                <ShieldCheck aria-hidden="true" className="h-3.5 w-3.5 text-deep" />
                Wallet pass · not a payment card
              </p>
              <h1 className="mt-6 text-balance text-5xl font-bold leading-[1.02] tracking-[-0.03em] text-ink sm:text-6xl">
                A pass that carries the limits, not the money.
              </h1>
              <p className="mt-6 max-w-xl text-lg leading-relaxed text-ink/70">
                {brand.name} puts an agent&rsquo;s spending mandate on a wallet pass — per purchase, per 24 hours, with
                an expiry and a revoke — so the limits travel with the agent and stay readable by the person paying.
              </p>
              <div className="mt-8 flex flex-wrap items-center gap-3">
                <Button asChild size="lg">
                  <a href="#how-it-works">
                    Four steps to a pass <ArrowRight aria-hidden="true" />
                  </a>
                </Button>
                <Button asChild variant="outline" size="lg">
                  <Link href="/dashboard">Open the dashboard preview</Link>
                </Button>
              </div>
              <p className="mt-5 text-sm text-muted">
                <span className="font-semibold text-ink">vouched by PayStage</span> · the pass and its checks are
                open source under MIT.
              </p>
            </div>

            <figure className="mx-auto w-full max-w-[22rem]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/pass/pass-face@2x.png"
                alt={`A ${brand.name} pass face in deep indigo: Research teammate, $0.50 per purchase, $20.00 per 24h, expires 31 Jan 2027, principal Northwind Ltd.`}
                width={750}
                height={1035}
                className="pass-shadow w-full rounded-[1.4rem] border border-ink/10 bg-paper"
              />
              <figcaption className="mt-3 text-center text-xs text-muted">
                Illustrative pass face — the limits shown are an example, not a live mandate.
              </figcaption>
            </figure>
          </div>
        </section>

        {/* Four-step sequence. Every frame is the shared storyboard, not a redrawing. */}
        <section id="how-it-works" className="scroll-mt-20 border-b border-ink/10 bg-paper">
          <div className="mx-auto max-w-6xl px-6 py-20">
            <div className="max-w-2xl">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted">Pick → configure → confirm → Wallet</p>
              <h2 className="mt-3 text-3xl font-bold tracking-tight text-ink sm:text-4xl">
                Four steps from a job to a wallet pass.
              </h2>
              <p className="mt-4 text-ink/70">
                The frames below are the product&rsquo;s own storyboard. The surface label on each one says where it
                happens, including the two steps that are not our page.
              </p>
            </div>

            <ol className="mt-12 grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
              {STEPS.map((step) => (
                <li key={step.n} className="flex flex-col">
                  <div className="relative overflow-hidden rounded-2xl border border-ink/10 bg-ink/[0.02] p-3">
                    <span
                      aria-hidden="true"
                      className="absolute left-5 top-5 z-10 flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold text-paper shadow-sm"
                      style={{ backgroundColor: step.tint }}
                    >
                      {step.n}
                    </span>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={step.image}
                      alt={step.alt}
                      width={420}
                      height={780}
                      className="w-full rounded-xl border border-ink/10"
                    />
                  </div>
                  <div className="mt-4 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">
                    <Wallet aria-hidden="true" className="h-3.5 w-3.5" />
                    {step.surface}
                  </div>
                  <h3 className="mt-1.5 text-base font-semibold text-ink">{step.title}</h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-ink/65">{step.body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* The honesty block: three things a pass is not. */}
        <section id="cannot" className="scroll-mt-20 border-b border-ink/10 bg-ink/[0.025]">
          <div className="mx-auto max-w-6xl px-6 py-20">
            <div className="grid gap-10 lg:grid-cols-[0.8fr_1.2fr]">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-red">What it cannot do</p>
                <h2 className="mt-3 text-3xl font-bold tracking-tight text-ink sm:text-4xl">
                  A pass is a record of authority. Nothing more.
                </h2>
                <p className="mt-4 text-ink/70">
                  The three exclusions matter more than the feature list, because they are what stop a screenshot from
                  implying a bank, a wallet or an escrow.
                </p>
              </div>
              <div className="grid gap-4 sm:grid-cols-3">
                {CANNOT.map((item) => {
                  const Icon = item.icon;
                  return (
                    <div key={item.title} className="rounded-xl border border-ink/10 bg-paper p-5">
                      <Icon aria-hidden="true" className="h-5 w-5 text-red" />
                      <h3 className="mt-4 text-base font-semibold text-ink">{item.title}</h3>
                      <p className="mt-2 text-sm leading-relaxed text-ink/65">{item.body}</p>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </section>

        {/* Hosted by us vs fork: two equal columns, same weight. */}
        <section id="hosted-or-fork" className="scroll-mt-20 border-b border-ink/10 bg-paper">
          <div className="mx-auto max-w-6xl px-6 py-20">
            <div className="max-w-2xl">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted">Two ways to run it</p>
              <h2 className="mt-3 text-3xl font-bold tracking-tight text-ink sm:text-4xl">Hosted by us, or fork it.</h2>
            </div>
            <div className="mt-10 grid gap-6 md:grid-cols-2">
              <div className="flex flex-col rounded-2xl border border-ink/10 bg-paper p-7 shadow-sm">
                <div className="flex items-center justify-between gap-3">
                  <ShieldCheck aria-hidden="true" className="h-5 w-5 text-deep" />
                  <Badge variant="gold">In build</Badge>
                </div>
                <h3 className="mt-4 text-xl font-semibold text-ink">Hosted by us</h3>
                <p className="mt-3 flex-1 text-sm leading-relaxed text-ink/65">
                  When the mandate store ships (#423/#436), we run signing, pass issuance and the public verification
                  page. You get a serial and a URL; we never hold the funds. Until then the dashboard is a preview,
                  and it says so on every screen.
                </p>
                <div className="mt-6">
                  <Button asChild variant="outline" className="w-full">
                    <Link href="/dashboard">See the preview</Link>
                  </Button>
                </div>
              </div>

              <div className="flex flex-col rounded-2xl border border-ink/10 bg-ink p-7 text-paper shadow-sm">
                <div className="flex items-center justify-between gap-3">
                  <GitFork aria-hidden="true" className="h-5 w-5 text-gold" />
                  <Badge variant="outline" className="border-paper/25 text-paper">
                    MIT
                  </Badge>
                </div>
                <h3 className="mt-4 text-xl font-semibold">Fork it</h3>
                <p className="mt-3 flex-1 text-sm leading-relaxed text-paper/70">
                  The pass renderer and the verification path are in the repository under MIT. Run your own issuer
                  line, your own signing keys and your own verification page, with no service of ours in the middle.
                </p>
                <div className="mt-6 flex items-center gap-2 text-xs text-paper/60">
                  <FileCheck2 aria-hidden="true" className="h-4 w-4" />
                  Same pass layout and state marks; you bring the mandate store.
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="bg-deep text-paper">
          <div className="mx-auto flex max-w-6xl flex-col items-start justify-between gap-6 px-6 py-12 md:flex-row md:items-center">
            <div className="flex items-start gap-4">
              <Fingerprint aria-hidden="true" className="mt-1 h-6 w-6 shrink-0 text-gold" />
              <div>
                <h2 className="text-xl font-semibold">The limits are the product.</h2>
                <p className="mt-1 max-w-xl text-sm text-paper/70">
                  A QR on the back goes to a public verification page; the seller can read the same state the holder
                  sees. The pass itself never signs.
                </p>
              </div>
            </div>
            <Button asChild variant="gold">
              <Link href="/dashboard">
                Open the dashboard <ArrowRight aria-hidden="true" />
              </Link>
            </Button>
          </div>
        </section>
      </main>

      <footer className="border-t border-ink/10 bg-paper">
        <div className="mx-auto max-w-6xl px-6 py-12">
          <div className="flex flex-col gap-8 md:flex-row md:items-start md:justify-between">
            <div>
              <Brand showIssuer />
              <p className="mt-4 max-w-sm text-sm text-muted">
                {brand.name} is a sibling brand to PayStage. PayStage appears only in the &ldquo;vouched by&rdquo; line,
                as the issuer of the pass.
              </p>
            </div>
            <nav aria-label="Footer" className="flex flex-wrap gap-x-8 gap-y-2 text-sm">
              <Link href="/dashboard" className="text-ink/70 hover:text-ink">
                Dashboard preview
              </Link>
              <a href="https://github.com/base-buzz/paystage" className="text-ink/70 hover:text-ink">
                Source
              </a>
              <a href="https://github.com/base-buzz/paystage/blob/main/LICENSE" className="text-ink/70 hover:text-ink">
                MIT licence
              </a>
            </nav>
          </div>

          <div className="mt-10 border-t border-ink/10 pt-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-4">
                {[
                  { src: "/pass/mark-active.svg", label: "Active" },
                  { src: "/pass/mark-revoked.svg", label: "Revoked" },
                  { src: "/pass/mark-expired.svg", label: "Expired" },
                ].map((mark) => (
                  <span key={mark.label} className="inline-flex items-center gap-1.5 text-xs font-medium text-muted">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={mark.src} alt={`${mark.label} conformance mark`} width={22} height={22} className="h-5 w-5" />
                    {mark.label}
                  </span>
                ))}
              </div>
              <p className="text-xs text-muted">
                Conformance mark — active, revoked and expired are the same three states on the pass, the verification
                page and the API.
              </p>
            </div>
            <p className="mt-6 text-xs text-muted">
              © 2026 {brand.name}. Demo screens say so; no live tenants are shown. Built as a separate app at{" "}
              <span className="font-mono">apps/vouchguard</span>.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
