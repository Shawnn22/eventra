import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Eventra Perps — AI Risk & Execution Copilot for DreamDEX",
  description: "Analyze live DreamDEX Perps, simulate liquidation risk, open wallet-controlled positions and close them partially or fully on Hideki Testnet.",
};

export default function PerpsLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
