const WALLETS = [
  "0xB85d5A03D3467FB95866D7966834CC780e364E05",
  "0x4d432213cF6797cCB8C3b31E49d80C907fE607fa",
  "0xAB7ACC5d92861E24f6E0468c2c4aeec879F67bB6",
] as const;

export function SyntheticWallets() {
  return (
    <section className="panel" style={{ padding: 16 }} aria-labelledby="synth-wallets-h">
      <h2 id="synth-wallets-h" className="panel-title">
        PayStage synthetic load
      </h2>
      <p className="panel-sub">
        Dedicated mainnet wallets used only for labelled synthetic traffic
        (<code>source=synthetic</code>). Not revenue. Not users. Loadgen starts
        disabled until funded.
      </p>
      <ul className="reason-list">
        {WALLETS.map((a) => (
          <li key={a}>
            <a
              href={`https://basescan.org/address/${a}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              <code>{a}</code>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
