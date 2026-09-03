import type { Metadata } from "next";
import "./globals.css";
import "./design-refresh.css";
import "./dreamdex-theme.css";
import "./dreamdex-proof.css";
import "./eventra-theme.css";

export const metadata: Metadata = {
  title: "Eventra — AI intelligence for Event Contracts",
  description:
    "Analyze live Event Contracts with AI, compare executable DreamDEX odds, and approve every order from your own wallet.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
