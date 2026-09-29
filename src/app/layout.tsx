import type { Metadata } from "next";
import type { ReactNode } from "react";

import "./globals.css";
import "./stage1.css";
import "./stage3.css";

export const metadata: Metadata = {
  title: "Agent Labs",
  description: "Private Agent Labs control centre.",
  robots: {
    index: false,
    follow: false,
    nocache: true,
    googleBot: {
      index: false,
      follow: false,
    },
  },
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
