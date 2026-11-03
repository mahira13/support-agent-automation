import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Support-Agent Prototyp",
  description: "KI-Support-Agent mit Compliance-Check – Prototyp für maorika & nedura (Beispieldaten)",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="de">
      <body>{children}</body>
    </html>
  );
}
