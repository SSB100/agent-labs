import type { Metadata } from "next";
import type { ReactNode } from "react";

import "./globals.css";
import "./stage1.css";

export const metadata: Metadata = {
  title: "Agent Labs",
  description: "A modular AI workforce platform built around durable workflows.",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
