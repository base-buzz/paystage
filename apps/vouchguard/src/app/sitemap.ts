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
  const lastModified = new Date();
  return [
    { url: view.homepage, lastModified, changeFrequency: "weekly", priority: 1 },
    { url: `${view.homepage}/brand`, lastModified, changeFrequency: "monthly", priority: 0.8 },
    { url: `${view.homepage}/privacy`, lastModified, changeFrequency: "yearly", priority: 0.4 },
    { url: `${view.homepage}/terms`, lastModified, changeFrequency: "yearly", priority: 0.4 },
  ];
}
