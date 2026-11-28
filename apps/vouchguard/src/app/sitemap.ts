import type { MetadataRoute } from "next";

import { view } from "@/lib/brand-config";

/**
 * Every public page, and nothing else (#476).
 *
 * It listed exactly one URL — the homepage — so a crawler had to guess that `/brand`, `/privacy` and `/terms` existed.
 * The dashboard stays out: it is noindex and disallowed in robots.txt, and a sitemap that contradicts robots.txt is a
 * sitemap nobody trusts.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  // `view.homepage` is a full URL with trailing slash in some modes; a sitemap with `//brand` is a URL a crawler normalises
  // and we would rather not rely on that.
  const base = view.homepage.replace(/\/+$/, "");
  const lastModified = new Date();
  return [
    { url: `${base}/`, lastModified, changeFrequency: "weekly", priority: 1 },
    { url: `${base}/brand`, lastModified, changeFrequency: "monthly", priority: 0.8 },
    { url: `${base}/pricing`, lastModified, changeFrequency: "monthly", priority: 0.7 },
    { url: `${base}/ask`, lastModified, changeFrequency: "weekly", priority: 0.6 },
    { url: `${base}/privacy`, lastModified, changeFrequency: "yearly", priority: 0.4 },
    { url: `${base}/terms`, lastModified, changeFrequency: "yearly", priority: 0.4 },
  ];
}
