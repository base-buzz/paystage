import type { Metadata } from "next";
import Link from "next/link";

/**
 * `/zh` — the landing page, in Chinese.
 *
 * Not a relabelled English page: this is a real translated route, because the `⋯` menu offers 简体中文 and a language
 * switch that changes nothing is exactly the "looks present" failure this project keeps removing.
 *
 * Deliberately a summary rather than a full mirror. Every claim here defers to the English page, and the tool table is
 * generated from the same source (`scripts/sync-tool-docs.mjs` writes the Chinese rows).
 */
export const metadata: Metadata = {
  title: "PayStage — 面向 AI 智能体的 x402 支付安全层",
  description:
    "在钱包签名之前判断这笔 x402 支付该不该付：返回 pay / review / do_not_pay，并给出触发的规则。只读，不持私钥，不签名。",
  alternates: { languages: { en: "/", "zh-CN": "/zh" } },
};

export default function ZhHome() {
  return (
    <main className="lp">
      <section className="lp-wrap" style={{ paddingTop: 40, paddingBottom: 40 }}>
        <p className="lp-eyebrow">X402 · MCP · BASE 上的 USDC</p>
        <h1 className="lp-hero-title">在签名之前，拦下这笔支付。</h1>
        <p className="lp-hero-sub">
          智能体现在会自己付钱。钱包照着智能体的要求签名，却没有人检查它该不该付。PayStage 是钱包之外的一层
          只读安全带：按你写的本地策略评估待签名的支付，返回 <strong>pay</strong>、<strong>review</strong> 或{" "}
          <strong>do_not_pay</strong>，并给出触发的规则。
        </p>
        <p>
          <Link className="lp-hero-cta" href="/try">
            试用一次评估
          </Link>{" "}
          <Link className="lp-hero-secondary" href="/glossary">
            术语表（中文与英文术语对照）
          </Link>
        </p>

        <h2>它不能做什么</h2>
        <p>
          已结算的支付无法追回；看起来正规但从不交付的商户不会被地址检查发现；绕开本层的直接签名不在覆盖范围内。
          全部边界见 <a href="https://github.com/base-buzz/paystage/blob/main/LIMITS.md">LIMITS.md</a>。
        </p>

        <h2>英文版本</h2>
        <p>
          <Link href="/">English landing page</Link> ·{" "}
          <a href="https://github.com/base-buzz/paystage/blob/main/README.zh-CN.md">中文 README</a> ·{" "}
          <Link href="/privacy">隐私</Link>
        </p>
      </section>
    </main>
  );
}
