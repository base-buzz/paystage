import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://paystage.xyz"),
  title: {
    default: "PayStage — Safety tools for AI agent payments",
    template: "%s — PayStage",
  },
  description:
    "PayStage is a read-only safety layer for AI agent payments: local-policy preflight that returns pay, review or do-not-pay before anything is signed.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
