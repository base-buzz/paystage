import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "PayStage Console",
  description:
    "Public seatbelt console: run payment safety scenarios, live Real/Synthetic/Test feed, and issue flags.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
