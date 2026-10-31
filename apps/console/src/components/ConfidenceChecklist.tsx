export function ConfidenceChecklist() {
  const items: { label: string; mark: "[x]" | "[ ]"; note?: string }[] = [
    { label: "Open source + SECURITY.md", mark: "[x]", note: "partial" },
    { label: "Published threat model with limitations", mark: "[ ]" },
    { label: "OpenSSF Scorecard", mark: "[ ]" },
    { label: "npm provenance / trusted publishing", mark: "[ ]" },
    { label: "Signed releases + SBOM", mark: "[ ]" },
    { label: "Socket.dev + Snyk once green", mark: "[ ]" },
    { label: "GitHub security policy; CodeQL + Dependabot", mark: "[ ]" },
    { label: "Small public bounty", mark: "[ ]" },
    {
      label: "MCP Registry / x402 / Base as distribution",
      mark: "[x]",
      note: "partially live",
    },
    {
      label: "Audit seals / Code4rena / Sherlock",
      mark: "[ ]",
      note: "never until an audit exists",
    },
  ];

  return (
    <section
      aria-labelledby="confidence-heading"
      className="panel"
      style={{ padding: 16 }}
    >
      <h2 id="confidence-heading" className="panel-title">
        Confidence
      </h2>
      <p className="panel-sub">
        Earnable signals only. No seals that are not earned.
      </p>
      <ul
        style={{
          listStyle: "none",
          margin: 0,
          padding: 0,
          display: "grid",
          gap: 6,
          fontSize: 13,
        }}
      >
        {items.map((item) => (
          <li
            key={item.label}
            style={{
              display: "flex",
              gap: 8,
              flexWrap: "wrap",
              alignItems: "baseline",
            }}
          >
            <code style={{ color: item.mark === "[x]" ? "var(--good)" : "var(--muted)" }}>
              {item.mark}
            </code>
            <span>{item.label}</span>
            {item.note ? (
              <span className="muted" style={{ fontSize: 12 }}>
                · {item.note}
              </span>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
