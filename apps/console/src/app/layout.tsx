import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://paystage.xyz"),
  title: {
    default: "PayStage — Safety tools for AI agent payments",
    template: "%s — PayStage",
  },
  // 148 characters. The previous one was 211 and Google truncates around 150–160, so the end of the
  // sentence — the part that says what it actually does — was the part being cut off.
  description:
    "Read-only preflight for AI agent payments: get pay, review or do-not-pay before anything is signed, with the rule that fired.",
  openGraph: {
    type: "website",
    url: "https://paystage.xyz",
    siteName: "PayStage",
    title: "Stop the payment before it's signed.",
    description:
      "Read-only preflight for AI agent payments: pay, review or do-not-pay — with the rule that fired.",
    images: [{ url: "/og.png", width: 1200, height: 630, alt: "PayStage — stop the payment before it's signed" }],
  },
  twitter: {
    // summary_large_image, not `summary`: the small card renders a thumbnail and loses the headline,
    // which is the entire message.
    card: "summary_large_image",
    title: "Stop the payment before it's signed.",
    description: "Read-only preflight for AI agent payments. Pay, review or do-not-pay — with the rule that fired.",
    images: ["/og.png"],
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
