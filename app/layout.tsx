import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Shower Timers",
  description: "Shared shower timer board and workgroup stats.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
