import type { Metadata } from "next";
import type { ReactNode } from "react";

import "./globals.css";
import { tokenStyle } from "@/lib/tokens";

export const metadata: Metadata = {
  metadataBase: new URL("https://vouchguard.app"),
  title: {
    default: "VouchGuard — a wallet pass for agent spending limits",
    template: "%s — VouchGuard",
  },
  description:
    "VouchGuard puts an agent's spending mandate on a wallet pass: per-purchase cap, per-24h cap, expiry and revocation. It is not a card, it holds no funds and it cannot tap to pay.",
  applicationName: "VouchGuard",
  robots: { index: true, follow: true },
  alternates: { canonical: "https://vouchguard.app/" },
  icons: { icon: "/pass/icon@2x.png", apple: "/pass/icon@3x.png" },
  openGraph: {
    type: "website",
    url: "https://vouchguard.app/",
    siteName: "VouchGuard",
    title: "A pass that carries the limits, not the money.",
    description:
      "The wallet pass for agent spending mandates. Per-purchase and per-24h caps, expiry, revocation — vouched by PayStage.",
    images: [
      {
        url: "/pass/pass-face@2x.png",
        width: 750,
        height: 1035,
        alt: "A VouchGuard pass face showing per-purchase and per-24h spending limits",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "A pass that carries the limits, not the money.",
    description:
      "The wallet pass for agent spending mandates. Per-purchase and per-24h caps, expiry, revocation — vouched by PayStage.",
    images: ["/pass/pass-face@2x.png"],
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" style={tokenStyle()}>
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
