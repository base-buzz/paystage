import type { MetadataRoute } from "next";

/** The dashboard is deliberately absent: it is noindex and disallowed in robots.txt. */
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: "https://vouchguard.app/",
      lastModified: new Date(),
      changeFrequency: "weekly",
      priority: 1,
    },
  ];
}
