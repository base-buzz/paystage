import type { MetadataRoute } from "next";

import { view } from "@/lib/brand-config";

/** The dashboard is deliberately absent: it is noindex and disallowed in robots.txt. */
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: view.homepage,
      lastModified: new Date(),
      changeFrequency: "weekly",
      priority: 1,
    },
  ];
}
