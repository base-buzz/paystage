import type { ReactNode } from "react";
import "./globals.css";

export const metadata = {
  title: "PayStage Console",
  description: "PayStage operations console",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
