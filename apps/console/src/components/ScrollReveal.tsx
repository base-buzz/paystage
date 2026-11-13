"use client";

import { useEffect } from "react";

/**
 * Staggered reveal on scroll.
 *
 * The hidden state lives behind a class this component adds to <html> on mount, so a page with
 * no JavaScript, or a failed hydration, renders everything visible. The usual mistake is to put
 * `opacity: 0` in the stylesheet and rely on JS to undo it — that ships blank sections to anyone
 * whose script fails, which is a worse outcome than no animation.
 *
 * Reduced motion is handled in CSS, not here: a component that has to know about it will
 * eventually forget.
 */
export function ScrollReveal() {
  useEffect(() => {
    const root = document.documentElement;
    const targets = Array.from(document.querySelectorAll<HTMLElement>("[data-reveal]"));
    if (targets.length === 0) return;

    root.classList.add("js-reveal");

    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const el = entry.target as HTMLElement;
          // Stagger within a group by DOM order, capped so a long list does not crawl.
          const group = el.parentElement?.querySelectorAll("[data-reveal]") ?? [el];
          const index = Array.prototype.indexOf.call(group, el);
          el.style.transitionDelay = `${Math.min(index, 5) * 70}ms`;
          el.classList.add("is-revealed");
          io.unobserve(el);
        }
      },
      { rootMargin: "0px 0px -12% 0px", threshold: 0.12 },
    );

    for (const el of targets) io.observe(el);
    return () => io.disconnect();
  }, []);

  return null;
}
