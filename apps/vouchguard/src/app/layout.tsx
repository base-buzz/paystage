import type { Metadata } from "next";
import type { CSSProperties, ReactNode } from "react";

import "./globals.css";
import { brand, view } from "@/lib/brand-config";
import { tokenStyle } from "@/lib/tokens";

export const metadata: Metadata = {
  metadataBase: new URL(view.homepage),
  title: {
    default: view.title,
    template: `%s — ${brand.name}`,
  },
  description: view.description,
  applicationName: brand.name,
  robots: { index: true, follow: true },
  alternates: { canonical: view.homepage },
  icons: { icon: "/pass/icon-2x.png", apple: "/pass/icon-3x.png" },
  openGraph: {
    type: "website",
    url: view.homepage,
    siteName: brand.name,
    title: "A pass that carries the limits, not the money.",
    description:
      "The wallet pass for agent spending mandates. Per-purchase and per-24h caps, expiry, revocation — vouched by PayStage.",
    images: [
      {
        url: "/pass/pass-face-2x.png",
        width: 750,
        height: 1035,
        alt: `A ${brand.name} pass face showing per-purchase and per-24h spending limits`,
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "A pass that carries the limits, not the money.",
    description:
      "The wallet pass for agent spending mandates. Per-purchase and per-24h caps, expiry, revocation — vouched by PayStage.",
    images: ["/pass/pass-face-2x.png"],
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  const rootStyle = { ...tokenStyle(), ...view.cssVariables } as CSSProperties;
  return (
    <html lang="en" style={rootStyle}>
      <body>
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[200] focus:rounded-md focus:bg-deep focus:px-4 focus:py-2 focus:text-paper"
        >
          Skip to content
        </a>
        {children}
      </body>
    </html>
  );
}
