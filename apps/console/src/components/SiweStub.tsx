"use client";

export function SiweStub() {
  const enabled = process.env.NEXT_PUBLIC_SIWE_ENABLED === "1";
  return (
    <section
      aria-labelledby="siwe-heading"
      className="panel"
      style={{ padding: 16 }}
    >
      <h2 id="siwe-heading" className="panel-title">
        SIWE
      </h2>
      <p className="muted" style={{ margin: 0, fontSize: 13 }}>
        {enabled
          ? "Sign-in with Ethereum flag on — session wiring pending (read-only)."
          : "SIWE deeper mode — coming soon (read-only wallet scan)."}
      </p>
    </section>
  );
}
