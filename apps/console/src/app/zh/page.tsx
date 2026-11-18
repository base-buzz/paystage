import type { Metadata } from "next";
import "../landing.css";
import Link from "next/link";
import { AliveStrip } from "@/components/AliveStrip";
import { ChartStrip } from "@/components/ChartStrip";
import { CopyCommand } from "@/components/CopyCommand";
import { LogoBanner } from "@/components/LogoBanner";
import { ScrollReveal } from "@/components/ScrollReveal";
import { LiveFeed } from "@/components/LiveFeed";
import { ChainTicker } from "@/components/ChainTicker";
import { SettledStrip } from "@/components/SettledStrip";
import { FunnelPanel } from "@/components/FunnelPanel";
import { TOOL_COUNT } from "@/lib/tools";

/**
 * `/zh` — the landing page, in Chinese.
 *
 * **A mirror, not a summary.** Until 2026-11-18 this page was 65 lines against the English page's 645: one hero, one
 * paragraph, two links — on a route the language switch offers as 简体中文. That is the "looks present" failure this
 * project keeps removing, so the sections below are the same sections in the same order, using the same components.
 * Tool names, field names and JSON stay English: a translated `evaluate_mcp_payment` would not be a tool an agent can
 * call, and a translated `payTo` would be a field that does not exist.
 */
export const metadata: Metadata = {
  title: "PayStage — 面向 AI 智能体的 x402 支付安全层",
  description:
    "在钱包签名之前判断这笔 x402 支付该不该付：返回 pay / review / do_not_pay，并给出触发的规则。只读，不持私钥，不签名。",
  alternates: { canonical: "https://paystage.xyz/zh", languages: { en: "/", "zh-CN": "/zh" } },
};

const TOOLS = [
  ["evaluate_mcp_payment", "把 x402 支付请求对照本地策略 → pay · review · do_not_pay"],
  ["evaluate_batch", "多笔支付对照同一份策略 · 逐条裁决，顺序不变"],
  ["list_outstanding_auths", "列出仍然有效的 ERC-20、Permit2、EIP-3009 授权"],
  ["evaluate_outstanding_auths", "标出下一笔支付之前需要处理的授权"],
  ["evaluate_hip3_trade", "HIP-3 / trade.xyz 订单对照 TradePolicy → allow · review · do_not_trade"],
  ["evaluate_velocity", "滚动速率与花费检查：突发、尖峰、失控的节奏"],
  ["verify_receipt", "用已发布的签名公钥校验一张收据"],
  ["decode_payment_required", "把 402 响应头解成 JSON challenge：先看清，再决定"],
  ["validate_policy", "单独校验一份策略文档 —— 多数支持请求背后都是这个问题"],
] as const;

export default function ZhHome() {
  return (
    <div className="lp">
      <main>
        <div className="lp-aurora" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <div className="lp-grain" aria-hidden="true" />
        <ScrollReveal />

        <section className="lp-hero">
          <div className="lp-wrap lp-hero-grid">
            <div>
              <p className="lp-eyebrow">x402 · MCP · Base 上的 USDC</p>
              <h1 className="lp-h1">
                在<em>签名之前</em>，拦下这笔支付。
              </h1>
              <p className="lp-lede">
                智能体现在会自己付钱 —— x402 API、MCP 服务、永续合约。钱包照着智能体的要求签名，却没有人检查
                这笔支付该不该发生。PayStage 是钱包之外的一层只读安全带：
                <strong>{TOOL_COUNT} 个小工具</strong>按你写的本地策略评估待签名的支付，返回{" "}
                <strong>pay</strong>、<strong>review</strong> 或 <strong>do_not_pay</strong>，并给出触发的那条规则。
              </p>
              <div className="lp-actions">
                <Link className="lp-btn lp-btn-primary" href="/try">
                  先试一次真实评估
                </Link>
                <CopyCommand command="npx -y -p @paystage/mcp paystage-mcp" />
              </div>
              <ul className="lp-reassure">
                <li>MIT 许可 —— 整套评估器开源，不是演示版本</li>
                <li>不持私钥、不签名；签名者始终是你的智能体</li>
                <li>不需要账户、不需要邮箱：智能体填不了注册表单</li>
              </ul>
            </div>
          </div>
        </section>

        <section className="lp-wrap" aria-label="可验证的出处">
          <div className="lp-badges">
            <a
              className="lp-badge lp-glass"
              href="https://registry.modelcontextprotocol.io/v0/servers?search=io.github.base-buzz"
            >
              <span className="dot" aria-hidden="true" />
              已列入官方 MCP Registry
            </a>
            <a className="lp-badge lp-glass" href="https://glama.ai/mcp/servers/base-buzz/paystage">
              <span className="dot" aria-hidden="true" />
              Glama 有收录
            </a>
            <a className="lp-badge lp-glass" href="https://www.npmjs.com/package/@paystage/mcp">
              <span className="dot" aria-hidden="true" />
              npm · 带 provenance 发布
            </a>
            <a className="lp-badge lp-glass" href="https://github.com/base-buzz/paystage/blob/main/LICENSE">
              <span className="dot" aria-hidden="true" />
              MIT 许可
            </a>
            <a className="lp-badge lp-glass" href="https://github.com/coinbase/x402">
              <span className="dot" aria-hidden="true" />
              构建在 x402 · Base 之上
            </a>
            <span className="lp-badge lp-glass lp-badge-static">
              <span className="dot" aria-hidden="true" />
              运行在 Cloudflare Workers
            </span>
          </div>
        </section>

        <section className="lp-proof" aria-label="事实">
          <div className="lp-wrap lp-proof-grid">
            <div className="lp-proof-item">
              <div className="lp-proof-value">{TOOL_COUNT}</div>
              <div className="lp-proof-label">个工具，各司其职</div>
            </div>
            <div className="lp-proof-item">
              <div className="lp-proof-value">2</div>
              <div className="lp-proof-label">个第三方运行时依赖</div>
            </div>
            <div className="lp-proof-item">
              <div className="lp-proof-value">0</div>
              <div className="lp-proof-label">私钥 · shell · 遥测</div>
            </div>
            <div className="lp-proof-item">
              <div className="lp-proof-value">$0.002</div>
              <div className="lp-proof-label">托管 API 每次调用</div>
            </div>
            <div className="lp-proof-item">
              <div className="lp-proof-value">MIT</div>
              <div className="lp-proof-label">源码、测试与 CI 公开</div>
            </div>
          </div>
        </section>

        <section className="lp-wrap" aria-label="实时动态">
          <ChainTicker />
          <SettledStrip />
          <FunnelPanel />
        </section>

        <LiveFeed />
        <LogoBanner />
        <ChartStrip />
        <AliveStrip />

        <section className="lp-section" id="how" data-reveal>
          <div className="lp-wrap">
            <div className="lp-section-head">
              <h2 className="lp-h2">它怎么工作</h2>
              <p className="lp-h2-note">
                三步，全部在本地完成。唯一的网络调用是一次 RPC 读取和一次只读行情查询。
              </p>
            </div>
            <ol className="lp-steps">
              <li>
                <strong>智能体提出一笔支付</strong>
                <span>服务器返回 402，附带可机器读取的条款：网络、资产、金额、收款地址。</span>
              </li>
              <li>
                <strong>PayStage 评估它</strong>
                <span>你自己的策略文件说了算 —— 金额上限、允许的收款方、允许的链、已知的盗币地址。</span>
              </li>
              <li>
                <strong>智能体拿到裁决</strong>
                <span>pay、review 或 do_not_pay，附带触发的那条规则。被拒绝时钱包根本不会签名。</span>
              </li>
            </ol>
          </div>
        </section>

        <section className="lp-section lp-section-alt" id="why" data-reveal>
          <div className="lp-wrap">
            <div className="lp-section-head">
              <h2 className="lp-h2" style={{ marginBottom: 18 }}>
                为什么是现在
              </h2>
              <p className="lp-h2-note">
                x402 让「付钱」变成一行 HTTP。它没有解决的是「该不该付」—— 那部分留给了调用方。
              </p>
            </div>
            <p className="lp-lede" style={{ maxWidth: 720 }}>
              钱包执行的是签名，不是意图。一个被提示词注入的智能体、一个降级的服务、一个改过价的 402
              响应，都能让一笔不该发生的支付通过。PayStage 把判断放在签名之前，用你写的策略，而不是服务器的说法。
            </p>
          </div>
        </section>

        <section className="lp-section" id="agents" data-reveal>
          <div className="lp-wrap">
            <div className="lp-section-head">
              <h2 className="lp-h2">给智能体用</h2>
              <p className="lp-h2-note">下面的指令可以直接交给一个会付钱的智能体。它不依赖任何账户或密钥。</p>
            </div>
            <pre className="lp-code" style={{ marginTop: 20 }}>{`使用 PayStage MCP 服务（https://api.paystage.xyz/mcp）
在签名之前评估每一笔 x402 支付。
显示裁决和触发的那条规则。
不要签署任何未通过评估的支付。`}</pre>
            <p className="lp-hero-note">服务是只读的，无法签名。如果你的客户端要求确认，那就是重点本身。</p>
          </div>
        </section>

        <section className="lp-section" id="evidence" data-reveal>
          <div className="lp-wrap">
            <div className="lp-section-head">
              <h2 className="lp-h2">安全，作为可核查的产物</h2>
              <p className="lp-h2-note">每一条都可以自己核对，不需要相信本页的说法。</p>
            </div>
            <div className="lp-cards">
              <a className="lp-card" href="https://github.com/base-buzz/paystage/blob/main/SECURITY.md" rel="noopener">
                <span className="lp-card-tag">SECURITY.md</span>
                <h3>它碰到什么，为什么</h3>
                <p>读一个策略文件、两个环境变量、两个只读端点。没有 shell、没有 eval、没有遥测、不托管私钥。</p>
              </a>
              <a
                className="lp-card"
                href="https://github.com/base-buzz/paystage/blob/main/packages/preflight/KNOWN_DRAINERS.md"
                rel="noopener"
              >
                <span className="lp-card-tag">KNOWN_DRAINERS.md</span>
                <h3>每一条拒绝都有出处</h3>
                <p>每个地址都带公开来源和检索日期。没有来源，就不进清单。</p>
              </a>
              <a className="lp-card" href="https://www.npmjs.com/package/@paystage/mcp" rel="noopener">
                <span className="lp-card-tag">npm provenance</span>
                <h3>在 CI 中构建，由 OIDC 签名</h3>
                <p>发布由工作流完成，provenance 面板可以核对是哪个提交、哪次运行产出了这个包。</p>
              </a>
              <Link className="lp-card" href="/privacy">
                <span className="lp-card-tag">隐私</span>
                <h3>没有账户，也没有邮箱</h3>
                <p>站点不需要注册。登录钱包是可选的便捷功能，只为了在设备之间同步主题和语言。</p>
              </Link>
            </div>
          </div>
        </section>

        <section className="lp-section">
          <div className="lp-wrap">
            <div className="lp-section-head">
              <h2 className="lp-h2">{TOOL_COUNT} 个工具</h2>
              <p className="lp-h2-note">
                用 <code>npx -y -p @paystage/mcp paystage-mcp</code> 一次装齐，或单独安装某个包。
              </p>
            </div>
            <table className="lp-table">
              <tbody>
                {TOOLS.map(([name, desc]) => (
                  <tr key={name}>
                    <td style={{ width: "38%" }}>
                      <code>{name}</code>
                    </td>
                    <td>{desc}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="lp-hero-note">
              也可以直接用托管 API：Base 主网（<code>api.paystage.xyz</code>）与 Base Sepolia，每次调用 $0.002
              USDC。
            </p>
          </div>
        </section>

        <section className="lp-section" id="faq" data-reveal>
          <div className="lp-wrap">
            <h2 className="lp-h2">谨慎的读者会问</h2>
            <div className="lp-faq">
              {[
                {
                  q: "能和我的技术栈一起用吗？",
                  a: "这个包是标准的 stdio MCP 服务，任何支持 MCP 的客户端都能用：Claude Desktop、Cursor、Cline、VS Code，以及任何带 MCP 客户端的智能体框架。托管端点就是普通 HTTP，那条路径什么都不用装。",
                },
                {
                  q: "这个项目还在维护吗？",
                  a: "发布是自动化的：每天从 main 发一个 canary，打 tag 时发稳定版，两者都带 npm provenance。提交历史、CI 日志和发布说明都是公开的 —— 你可以自己核对，而不是信这句话。",
                },
                {
                  q: "我能在信任它之前读代码吗？",
                  a: "能。它是 MIT，产生裁决的评估器就是测试跑的那份代码。仓库里的收据测试向量可以用 sha256sum 直接核对，无需安装任何东西。",
                },
                {
                  q: "它覆盖不到什么？",
                  a: "结算之后的追回、合谋的收款方、以及任何链下的承诺。这道闸决定「要不要签名」；它不能把钱收回来，也不知道卖家收到钱之后会做什么。边界见 LIMITS.md。",
                },
                {
                  q: "它会持有我的私钥吗？",
                  a: "不会。它只返回裁决，从不签名。你的智能体始终是唯一的签名者，这一点由代码的行为保证，而不是由一句声明保证。",
                },
                {
                  q: "调用要花多少钱？",
                  a: "每个 IP 每天前 1,000 次评估免费，不需要账户。之后托管 API 每次 $0.002，通过 x402 支付。包本身免费，MIT 许可。",
                },
              ].map((item) => (
                <details className="lp-faq-item" key={item.q}>
                  <summary className="lp-faq-q">{item.q}</summary>
                  <p className="lp-faq-a">{item.a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        <section className="lp-cta-final" data-reveal>
          <div className="lp-wrap">
            <h2 className="lp-h2">先试，再决定要不要信</h2>
            <p className="lp-hero-note" style={{ maxWidth: 620 }}>
              一次真实评估，不用安装：任何人向托管 API 发一个支付挑战，就能看到自己的智能体会收到什么裁决。
            </p>
            <div className="lp-actions" style={{ marginTop: 22 }}>
              <Link className="lp-btn lp-btn-primary" href="/try">
                跑一次真实评估
              </Link>
              <a className="lp-btn lp-btn-ghost" href="https://github.com/base-buzz/paystage" rel="noopener">
                读源码
              </a>
            </div>
          </div>
        </section>
      </main>

      <footer className="lp-footer">
        <div className="lp-wrap">
          <div className="lp-footer-top">
            <div>
              <div className="lp-brand" style={{ marginBottom: 8 }}>
                <span>PayStage</span>
              </div>
              <div className="lp-hero-note" style={{ margin: 0 }}>
                给会花钱的智能体的一层只读安全带。
              </div>
            </div>
            <div className="lp-footer-nav">
              <Link href="/">English</Link>
              <Link href="/privacy">隐私</Link>
              <a href="https://github.com/base-buzz/paystage/blob/main/LIMITS.md">LIMITS.md</a>
              <a href="https://github.com/base-buzz/paystage/blob/main/README.zh-CN.md">中文 README</a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
