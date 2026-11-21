import type { Metadata } from "next";
import "../landing.css";
import {
  EMPTY_MESSAGE,
  loadWalletView,
  type WalletCategories,
  type WalletView,
} from "@/lib/payee-category-view";

export const dynamic = "force-dynamic";

/**
 * `/wallets` — the minimal page for #310.
 *
 * It renders the hosted API's observation rows and labels, with the source and the date that source was
 * read beside every one. It has no score, no "trust" badge and no inferred reputation, because those are
 * exactly what the item forbids.
 *
 * `robots: noindex` while collecting is still a follow-up: an empty observation page should not be the
 * version a search engine files. Remove this only when there is a collector writing rows.
 */
export const metadata: Metadata = {
  title: "Payee categories",
  description:
    "What named sources observed about an EVM payee, with the source and the date each observation was read.",
  robots: { index: false, follow: false },
};

function formatValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

function Value({ value }: { value: unknown }) {
  return <code>{formatValue(value)}</code>;
}

function Categories({ categories }: { categories: WalletCategories }) {
  return (
    <>
      <p className="lp-lead">
        {categories.observations.length} observation{categories.observations.length === 1 ? "" : "s"} for{" "}
        <code>{categories.address}</code>. Every label below names the source and the date that source was read.
        There is no score and no combined verdict: a missing field means no source recorded it, not a default value.
      </p>

      <h2>Labels</h2>
      <table>
        <thead>
          <tr>
            <th>Field</th>
            <th>Value</th>
            <th>Source</th>
            <th>Read at</th>
          </tr>
        </thead>
        <tbody>
          {categories.labels.map((label, index) => (
            <tr key={`${label.field}-${formatValue(label.value)}-${index}`}>
              <td>
                <code>{label.field}</code>
              </td>
              <td>
                <Value value={label.value} />
              </td>
              <td>
                {label.provenance.map((entry) => (
                  <div key={`${entry.source}-${entry.observed_at}`}>
                    <code>{entry.source}</code>
                  </div>
                ))}
              </td>
              <td>
                {label.provenance.map((entry) => (
                  <div key={`${entry.source}-${entry.observed_at}-at`}>{entry.observed_at}</div>
                ))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {categories.disagreements.length > 0 ? (
        <>
          <h2>Disagreements</h2>
          <p>
            These fields were claimed differently by more than one source. Both claims are kept. Nothing below picks a
            winner.
          </p>
          <table>
            <thead>
              <tr>
                <th>Field</th>
                <th>Value</th>
                <th>Source</th>
                <th>Read at</th>
              </tr>
            </thead>
            <tbody>
              {categories.disagreements.flatMap((disagreement) =>
                disagreement.values.map((entry, index) => (
                  <tr key={`${disagreement.field}-${entry.source}-${entry.observed_at}-${index}`}>
                    <td>
                      <code>{disagreement.field}</code>
                    </td>
                    <td>
                      <Value value={entry.value} />
                    </td>
                    <td>
                      <code>{entry.source}</code>
                    </td>
                    <td>{entry.observed_at}</td>
                  </tr>
                )),
              )}
            </tbody>
          </table>
        </>
      ) : null}

      <h2>Observations</h2>
      <table>
        <thead>
          <tr>
            <th>Source</th>
            <th>Read at</th>
            <th>Field</th>
            <th>Value</th>
          </tr>
        </thead>
        <tbody>
          {categories.observations.map((observation, index) => (
            <tr key={`${observation.source}-${observation.observed_at}-${observation.field}-${index}`}>
              <td>
                <code>{observation.source}</code>
              </td>
              <td>{observation.observed_at}</td>
              <td>
                <code>{observation.field}</code>
              </td>
              <td>
                <Value value={observation.value} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

function AddressForm({ address }: { address: string }) {
  return (
    <form method="get" action="/wallets" style={{ display: "flex", flexWrap: "wrap", gap: 8, margin: "16px 0" }}>
      <label htmlFor="address" style={{ flexBasis: "100%" }}>
        EVM payee address
      </label>
      <input
        id="address"
        name="address"
        defaultValue={address}
        placeholder="0x…"
        autoComplete="off"
        spellCheck={false}
        style={{ flex: "1 1 26rem", fontFamily: "monospace", padding: "8px 10px" }}
      />
      <button type="submit" style={{ padding: "8px 14px" }}>
        Read observations
      </button>
    </form>
  );
}

export default async function WalletsPage({
  searchParams,
}: {
  searchParams: Promise<{ address?: string | string[] }>;
}) {
  const params = await searchParams;
  const raw = typeof params.address === "string" ? params.address : "";
  const address = raw.trim();

  let view: WalletView;
  if (address === "") view = { kind: "idle" };
  else view = await loadWalletView(address);

  return (
    <main className="lp-wrap lp-prose">
      <h1>Payee categories</h1>
      <AddressForm address={address} />

      {view.kind === "idle" ? (
        <p className="lp-lead">
          Enter an EVM address to read the observations recorded for it. This page reads stored observations; it does not
          collect them itself.
        </p>
      ) : null}

      {view.kind === "empty" ? <p>{EMPTY_MESSAGE}</p> : null}

      {view.kind === "unavailable" ? (
        <p>
          <strong>Could not read this address:</strong> {view.reason}. This is not the same as an address with no
          observations.
        </p>
      ) : null}

      {view.kind === "ready" ? <Categories categories={view.categories} /> : null}
    </main>
  );
}
