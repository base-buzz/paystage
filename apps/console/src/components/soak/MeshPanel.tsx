import { Panel } from "@/components/soak/Panel";
import { formatEth, formatInt, formatPayment, formatTimestamp, linkWidth, nodeRadius, percent, shortAddress } from "@/lib/soak-mesh";
import type { SoakProjection } from "@/lib/soak-mesh-types";

const COLORS = ["#6ee7b7", "#7aa2ff", "#f5b544", "#c4b5fd", "#f472b6", "#67e8f9", "#a3e635", "#fca5a5", "#93c5fd", "#fcd34d", "#5eead4", "#d8b4fe"];
const OTHERS = "#6b7280";

function MeshDiagram({ projection }: { projection: SoakProjection }) {
  const { left, right, edges } = projection.mesh;
  const width = 1080;
  const height = 640;
  const leftX = 260;
  const rightX = 820;
  const top = 62;
  const bottom = 22;
  const step = (height - top - bottom) / Math.max(1, Math.max(left.length, right.length) - 1);
  const leftY = new Map(left.map((node, i) => [node.id, top + i * step + (height - top - bottom - (left.length - 1) * step) / 2]));
  const rightY = new Map(right.map((node, i) => [node.id, top + i * step + (height - top - bottom - (right.length - 1) * step) / 2]));
  const maxMicro = Math.max(...left.map((node) => node.micro), ...right.map((node) => node.micro));
  const maxCount = Math.max(...edges.map((edge) => edge.count), 1);
  const payerIndex = new Map(left.filter((node) => !node.isOthers).map((node, i) => [node.id, i]));

  return (
    <figure className="mesh-figure">
      <svg
        className="mesh-svg"
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`Payment mesh: ${left.length} payer nodes on the left, ${right.length} payee nodes on the right, ${edges.length} links whose width is payment count.`}
      >
        <text className="mesh-svg-col" x={leftX} y={24} textAnchor="middle">
          Payers · {formatInt(projection.counts.wallets)}
        </text>
        <text className="mesh-svg-col" x={rightX} y={24} textAnchor="middle">
          Payees · {formatInt(projection.counts.payees)}
        </text>
        {edges.map((edge) => {
          const y1 = leftY.get(edge.from) ?? 0;
          const y2 = rightY.get(edge.to) ?? 0;
          const stroke = edge.from === "others" || edge.to === "others" ? OTHERS : COLORS[(payerIndex.get(edge.from) ?? 0) % COLORS.length];
          const mid = (leftX + rightX) / 2;
          return (
            <path
              key={`${edge.from}->${edge.to}`}
              d={`M ${leftX} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${rightX} ${y2}`}
              fill="none"
              stroke={stroke}
              strokeWidth={linkWidth(edge.count, maxCount)}
              strokeOpacity={edge.from === "others" || edge.to === "others" ? 0.3 : 0.55}
              strokeLinecap="round"
            >
              <title>{`${edge.from} → ${edge.to}: ${formatInt(edge.count)} payments, ${formatEth(edge.micro)} ETH`}</title>
            </path>
          );
        })}
        {left.map((node) => {
          const y = leftY.get(node.id) ?? 0;
          const r = nodeRadius(node.micro, maxMicro);
          const fill = node.isOthers ? OTHERS : COLORS[(payerIndex.get(node.id) ?? 0) % COLORS.length];
          return (
            <g key={`left-${node.id}`}>
              <circle cx={leftX} cy={y} r={r} fill={fill} fillOpacity={node.isOthers ? 0.7 : 0.95} stroke={fill} strokeOpacity={0.9} />
              <text className="mesh-svg-node" x={leftX - r - 10} y={y - 3} textAnchor="end">
                {node.isOthers ? `others · ${node.members} payers` : node.id}
              </text>
              <text className="mesh-svg-sub" x={leftX - r - 10} y={y + 11} textAnchor="end">
                {formatInt(node.payments)} pay · {formatEth(node.micro)} ETH
              </text>
            </g>
          );
        })}
        {right.map((node) => {
          const y = rightY.get(node.id) ?? 0;
          const r = nodeRadius(node.micro, maxMicro);
          return (
            <g key={`right-${node.id}`}>
              <circle cx={rightX} cy={y} r={r} fill={node.isOthers ? OTHERS : "#7aa2ff"} fillOpacity={node.isOthers ? 0.7 : 0.95} stroke={node.isOthers ? OTHERS : "#7aa2ff"} />
              <text className="mesh-svg-node" x={rightX + r + 10} y={y - 3}>
                {node.isOthers ? `others · ${node.members} payees` : shortAddress(node.id)}
              </text>
              <text className="mesh-svg-sub" x={rightX + r + 10} y={y + 11}>
                {formatInt(node.payments)} pay · {formatEth(node.micro)} ETH
              </text>
            </g>
          );
        })}
      </svg>
      <figcaption className="mesh-figcaption">
        Link width = payment count. Nodes are sized by value. The <code>others</code> node on each side is an aggregate, not an account.
      </figcaption>
    </figure>
  );
}

export function MeshPanel({ projection }: { projection: SoakProjection }) {
  const { mesh, counts, samples } = projection;
  const leftOthers = mesh.left.find((node) => node.isOthers);
  const rightOthers = mesh.right.find((node) => node.isOthers);
  const maxEdge = mesh.edges[0];

  return (
    <Panel
      index={1}
      id="mesh"
      title="The mesh"
      question="Who paid whom, and how often?"
      proves="The rail carried this exact payer → payee graph: every link is a count of rows with a real tx hash, and no edge or node was invented."
      doesNot="that this is a market. It is our load generator's address set, and 98.3% of its payments touch an aggregate node."
      source={projection.source}
      windowStart={projection.window.start}
      windowEnd={projection.window.end}
    >
      <p className="mesh-lede">
        Payers on the left, payees on the right. At 100 × 100, drawing every node would be a hairball, so the top{" "}
        {mesh.topN} payers and top {mesh.topN} payees <strong>by value</strong> are drawn individually and every remaining
        account is folded into one <code>others</code> node on its side. The mesh therefore draws{" "}
        <strong>
          {mesh.left.length} + {mesh.right.length} = {mesh.left.length + mesh.right.length} nodes
        </strong>{" "}
        for {formatInt(counts.wallets)} payers and {formatInt(counts.payees)} payees. The <code>others</code> payer node
        aggregates {leftOthers?.members ?? 0} payers ({formatInt(leftOthers?.payments ?? 0)} payments,{" "}
        {formatEth(leftOthers?.micro ?? 0)} ETH); the <code>others</code> payee node aggregates{" "}
        {rightOthers?.members ?? 0} payees ({formatInt(rightOthers?.payments ?? 0)} payments,{" "}
        {formatEth(rightOthers?.micro ?? 0)} ETH).{" "}
        {formatInt(mesh.throughOthers.payments)} of {formatInt(counts.withTx)} payments ({percent(mesh.throughOthers.share)})
        touch an <code>others</code> endpoint, so the heavy grey links are that aggregate, not one account. The largest
        single group is <code>{maxEdge?.from}</code> → <code>{maxEdge?.to}</code>: {formatInt(maxEdge?.count ?? 0)} payments.
      </p>

      <MeshDiagram projection={projection} />

      <div className="mesh-sample-head">
        <h3>Ten largest payments, each linked by tx hash</h3>
        <p>
          Every payment rendered individually on this page links to Basescan Sepolia. These ten are a sample of the
          largest row amounts; the other {formatInt(counts.withTx - samples.length)} are aggregated in the panels above
          and can be re-derived from the snapshot.
        </p>
      </div>
      <div className="mesh-table-wrap">
        <table className="mesh-table">
          <caption className="mesh-sr-only">Largest sampled payments, with transaction hashes</caption>
          <thead>
            <tr>
              <th scope="col">Time (UTC)</th>
              <th scope="col">Payer</th>
              <th scope="col">Payee</th>
              <th scope="col">Amount</th>
              <th scope="col">Transaction</th>
            </tr>
          </thead>
          <tbody>
            {samples.map((sample) => (
              <tr key={sample.tx}>
                <td>{formatTimestamp(sample.at)}</td>
                <td>{sample.wallet}</td>
                <td title={sample.payee}>{sample.payeeShort}</td>
                <td>{formatPayment(sample.amount)}</td>
                <td>
                  <a className="mesh-tx-link" href={sample.url} rel="noreferrer">
                    Basescan Sepolia ↗
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
