"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { WalletChip } from "@/components/WalletChip";

/**
 * One header for every route.
 *
 * It used to live inside the landing page, so `/privacy`, `/glossary` and `/try` had no navigation at all. Anchors are
 * now absolute (`/#how`) because the same nav renders on pages that have no such section.
 *
 * Three controls, and only three:
 *   ⋯      theme, language, docs — the things a visitor changes once
 *   wallet the only identity this product has; a chip, not a profile picture, because there is no account
 */
type Theme = "system" | "light" | "dark";

const THEME_KEY = "paystage.theme";

function applyTheme(theme: Theme) {
  const root = document.documentElement;
  if (theme === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", theme);
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    // Private mode: the choice lasts for this page, which is still better than ignoring it.
  }
}

export function SiteHeader() {
  // Language comes from the route, not a prop: the header renders once, in the root layout, and a nested layout that
  // rendered a second one would put two headers on /zh.
  const pathname = usePathname();
  const lang: "en" | "zh" = pathname?.startsWith("/zh") ? "zh" : "en";
  const [menuOpen, setMenuOpen] = useState(false);
  const [theme, setTheme] = useState<Theme>("system");
  const [scrolled, setScrolled] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const stored = (localStorage.getItem(THEME_KEY) as Theme | null) ?? "system";
    setTheme(stored);
    applyTheme(stored);
  }, []);

  // Transparent over the hero, solid once content slides under it — otherwise the links sit on top of body copy.
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Escape closes the menu; clicking outside does too. A menu that traps focus without a way out is worse than no menu.
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMenuOpen(false);
    const onClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClick);
    };
  }, [menuOpen]);

  return (
    <header className="site-header" data-scrolled={scrolled ? "true" : "false"}>
      <div className="site-header-inner">
        <Link className="site-brand" href={lang === "zh" ? "/zh" : "/"} aria-label="PayStage">
          <PpMark />
          <span>PayStage</span>
        </Link>

        <nav className="site-nav" aria-label={lang === "zh" ? "主导航" : "Primary"}>
          <Link href={lang === "zh" ? "/zh#how" : "/#how"}>{lang === "zh" ? "工作原理" : "How it works"}</Link>
          <Link href={lang === "zh" ? "/zh#why" : "/#why"}>{lang === "zh" ? "为什么现在" : "Why now"}</Link>
          <Link href={lang === "zh" ? "/zh#agents" : "/#agents"}>{lang === "zh" ? "面向智能体" : "For agents"}</Link>
          <Link href="/lists">{lang === "zh" ? "名单" : "Lists"}</Link>
          <Link href="/glossary">{lang === "zh" ? "术语表" : "Glossary"}</Link>
          <Link href="/console">{lang === "zh" ? "控制台" : "Console"}</Link>
        </nav>

        <div className="site-actions" ref={menuRef}>
          <button
            type="button"
            className="site-icon-button"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            aria-label={lang === "zh" ? "更多" : "More"}
            onClick={() => setMenuOpen((v) => !v)}
          >
            ⋯
          </button>

          {menuOpen && (
            <div className="site-menu" role="menu">
              <div className="site-menu-group">
                <span className="site-menu-label">{lang === "zh" ? "主题" : "Theme"}</span>
                {(["system", "light", "dark"] as Theme[]).map((option) => (
                  <button
                    key={option}
                    role="menuitemradio"
                    aria-checked={theme === option}
                    className={theme === option ? "is-active" : undefined}
                    onClick={() => {
                      setTheme(option);
                      applyTheme(option);
                    }}
                  >
                    {option === "system" ? (lang === "zh" ? "跟随系统" : "System") : option === "light" ? (lang === "zh" ? "浅色" : "Light") : lang === "zh" ? "深色" : "Dark"}
                  </button>
                ))}
              </div>

              <div className="site-menu-group">
                <span className="site-menu-label">{lang === "zh" ? "语言" : "Language"}</span>
                <Link role="menuitemradio" aria-checked={lang === "en"} href="/" className={lang === "en" ? "is-active" : undefined}>
                  English
                </Link>
                {/* A real route, not a relabelled page: /zh exists and is translated. */}
                <Link role="menuitemradio" aria-checked={lang === "zh"} href="/zh" className={lang === "zh" ? "is-active" : undefined}>
                  简体中文
                </Link>
              </div>

              <div className="site-menu-group site-menu-mobile-nav">
                <span className="site-menu-label">{lang === "zh" ? "导航" : "Navigate"}</span>
                <Link href={lang === "zh" ? "/zh#how" : "/#how"}>{lang === "zh" ? "工作原理" : "How it works"}</Link>
                <Link href={lang === "zh" ? "/zh#why" : "/#why"}>{lang === "zh" ? "为什么现在" : "Why now"}</Link>
                <Link href={lang === "zh" ? "/zh#agents" : "/#agents"}>{lang === "zh" ? "面向智能体" : "For agents"}</Link>
                <Link href="/console">{lang === "zh" ? "控制台" : "Console"}</Link>
              </div>

              <div className="site-menu-group">
                <span className="site-menu-label">{lang === "zh" ? "文档" : "Docs"}</span>
                <Link href="/privacy">{lang === "zh" ? "隐私" : "Privacy"}</Link>
                <Link href="/lists">{lang === "zh" ? "名单" : "Lists"}</Link>
                <Link href="/glossary">{lang === "zh" ? "术语表" : "Glossary"}</Link>
                <a href="https://github.com/base-buzz/paystage/blob/main/LIMITS.md">LIMITS.md</a>
              </div>
            </div>
          )}

          <WalletChip />
        </div>
      </div>
    </header>
  );
}

function PpMark() {
  return (
    <svg className="site-brand-mark" viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="7" fill="#0a0b0e" />
      <path
        d="M11 8h6.2c3.1 0 5.3 2 5.3 5s-2.2 5-5.3 5H14v6h-3V8zm3 2.6v4.8h3c1.5 0 2.4-.9 2.4-2.4s-.9-2.4-2.4-2.4h-3z"
        fill="#6ee7b7"
      />
      <circle cx="23.5" cy="23.5" r="2.5" fill="#34d399" />
    </svg>
  );
}
