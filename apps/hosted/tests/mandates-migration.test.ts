import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The mandates migration (#453) is asserted on its SQL text, because there is no database in this
 * suite and applying one is not this repo's test path. That is a deliberately cheap check of the
 * property that matters: RLS and a tenant-keyed policy set ship in the *first* migration, and no
 * policy is `using (true)`.
 *
 * A text assertion cannot prove Postgres accepts the file. The parent applies the migration; that run
 * is the proof of syntax.
 */

const SQL = readFileSync(
  join(import.meta.dirname, "../../../supabase/migrations/20261126120000_mandates.sql"),
  "utf8",
);

/** Negative assertions run on the statements, not on the prose: the comments name the anti-patterns. */
const SQL_CODE = SQL.replace(/--[^\n]*/g, "");

const POLICY_RE = /create policy\s+(\w+)\s+on\s+public\.mandates\s+([\s\S]*?);/g;

function policies(): { name: string; body: string }[] {
  return [...SQL.matchAll(POLICY_RE)].map((match) => ({ name: match[1] ?? "", body: match[2] ?? "" }));
}

describe("the mandates table", () => {
  it("keys on serial and carries the signed envelope verbatim", () => {
    expect(SQL).toMatch(/create table if not exists public\.mandates/i);
    expect(SQL).toMatch(/serial text primary key/i);
    expect(SQL).toMatch(/tenant_id text not null/i);
    expect(SQL).toMatch(/state text not null check \(state in \('active', 'revoked', 'expired'\)\)/i);
    expect(SQL).toMatch(/scope jsonb not null/i);
    expect(SQL).toMatch(/envelope jsonb not null/i);
    expect(SQL).toMatch(/issued_at timestamptz not null/i);
    expect(SQL).toMatch(/expires_at timestamptz not null/i);
    expect(SQL).toMatch(/principal text not null/i);
    expect(SQL).toMatch(/agent text not null/i);
    expect(SQL).toMatch(/revoked_at timestamptz/i);
    expect(SQL).toMatch(/revocation jsonb/i);
    expect(SQL).toMatch(/created_at timestamptz not null default now\(\)/i);
  });

  it("has no payee, spend-history or separate signature column to leak", () => {
    // `allowed_payees` lives inside scope/envelope; a column would make it selectable by habit.
    expect(SQL).not.toMatch(/^\s*(?:allowed_payees|payees|spend|history|signature)\s+/im);
  });
});

describe("RLS and the tenant policy set ship in the same file", () => {
  it("enables row level security", () => {
    expect(SQL).toMatch(/alter table public\.mandates enable row level security/i);
  });

  it("has select, insert and update policies, all keyed by tenant_id", () => {
    const found = policies();
    expect(found.map((policy) => policy.name).sort()).toEqual([
      "mandates_tenant_insert",
      "mandates_tenant_select",
      "mandates_tenant_update",
    ]);
    for (const policy of found) {
      expect(policy.body, policy.name).toMatch(/tenant_id/);
      expect(policy.body, policy.name).toMatch(/current_setting\('request\.jwt\.claims'/);
    }
  });

  it("never opens a policy with using (true) and never grants delete or all", () => {
    expect(SQL_CODE).not.toMatch(/using\s*\(\s*true\s*\)/i);
    expect(SQL_CODE).not.toMatch(/for\s+all\b/i);
    expect(SQL_CODE).not.toMatch(/for\s+delete\b/i);
    for (const policy of policies()) {
      expect(policy.body, policy.name).not.toMatch(/using\s*\(\s*true\s*\)/i);
    }
  });

  it("scopes insert and update with a WITH CHECK, not just a USING", () => {
    const byName = new Map(policies().map((policy) => [policy.name, policy.body]));
    expect(byName.get("mandates_tenant_insert")).toMatch(/with check/i);
    expect(byName.get("mandates_tenant_update")).toMatch(/with check/i);
    expect(byName.get("mandates_tenant_update")).toMatch(/using/i);
  });
});
