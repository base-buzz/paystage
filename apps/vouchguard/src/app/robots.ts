import type { MetadataRoute } from "next";

import { view } from "@/lib/brand-config";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/dashboard", "/dashboard/"],
      },
    ],
    sitemap: `${view.verificationBase}/sitemap.xml`,
    host: view.verificationBase,
  };
}
