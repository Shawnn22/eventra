"use client";

import { useEffect, useRef, useState } from "react";

import { useBrowserWallet, type UseBrowserWalletResult } from "@/hooks/use-browser-wallet";
import { detectBrowserWallets, type BrowserWalletId } from "@/lib/wallet/browser-wallet";

type ConnectWalletProps = {
  wallet?: UseBrowserWalletResult;
  className?: string;
  openSignal?: number;
};

function shortAddress(addr: string) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export function ConnectWallet({ wallet: external, className, openSignal = 0 }: ConnectWalletProps) {
  const internal = useBrowserWallet();
  const wallet = external ?? internal;
  const { status, account, connect, disconnect, switchChain } = wallet;
  const [pickerOpen, setPickerOpen] = useState(false);
  const [installed, setInstalled] = useState<Record<BrowserWalletId, boolean>>({ metamask: false, okx: false, injected: false });
  const pickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => setInstalled(detectBrowserWallets()), []);
  useEffect(() => {
    if (openSignal > 0 && status !== "ready" && status !== "connecting") setPickerOpen(true);
  }, [openSignal, status]);
  useEffect(() => {
    if (!pickerOpen) return;
    const close = (event: MouseEvent) => {
      if (!pickerRef.current?.contains(event.target as Node)) setPickerOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [pickerOpen]);

  const chooseWallet = (id: BrowserWalletId, installUrl: string) => {
    if (!installed[id]) {
      window.open(installUrl, "_blank", "noopener,noreferrer");
      return;
    }
    setPickerOpen(false);
    void connect(id);
  };

  if (status === "connecting") {
    return (
      <div className={`wallet-chip connecting ${className ?? ""}`}>
        <span className="wallet-dot" /><span>Connecting…</span>
      </div>
    );
  }
  if (status === "ready" && account) {
    return (
      <div className={`wallet-chip ready ${className ?? ""}`}>
        <span className="wallet-dot" />
        <span title={account}>{shortAddress(account)}</span>
        <button type="button" className="wallet-action" onClick={disconnect}>Disconnect</button>
      </div>
    );
  }
  if (status === "wrong_chain") {
    return (
      <div className={`wallet-chip wrong ${className ?? ""}`}>
        <span className="wallet-dot" /><span>Wrong network</span>
        <button type="button" className="wallet-action primary" onClick={() => void switchChain()}>
          Switch to 50312
        </button>
      </div>
    );
  }
  return (
    <div ref={pickerRef} className={`wallet-connect ${className ?? ""}`}>
      <div className="wallet-chip disconnected">
      <span className="wallet-dot" />
      <button type="button" className="wallet-action primary" aria-expanded={pickerOpen} onClick={() => setPickerOpen((open) => !open)}>
        Connect wallet
      </button>
      </div>
      {pickerOpen ? (
        <div className="wallet-picker" role="dialog" aria-label="Choose a wallet">
          <header><b>Connect a wallet</b><small>Somnia · Chain 50312</small></header>
          <button type="button" onClick={() => chooseWallet("metamask", "https://metamask.io/download/")}><span className="wallet-logo metamask"><img src="/wallets/metamask.svg" alt="" /></span><span><b>MetaMask</b><small>{installed.metamask ? "Detected" : "Install extension"}</small></span><i>{installed.metamask ? "Connect" : "↗"}</i></button>
          <button type="button" onClick={() => chooseWallet("okx", "https://www.okx.com/web3")}><span className="wallet-logo okx"><img src="/wallets/okx.svg" alt="" /></span><span><b>OKX Wallet</b><small>{installed.okx ? "Detected" : "Install extension"}</small></span><i>{installed.okx ? "Connect" : "↗"}</i></button>
          <button type="button" disabled={!installed.injected} onClick={() => chooseWallet("injected", "")}><span className="wallet-logo browser" aria-hidden="true"><span className="browser-wallet-glyph">◫</span></span><span><b>Browser wallet</b><small>{installed.injected ? "Rabby, Coinbase or another EVM wallet" : "No EVM wallet detected"}</small></span><i>{installed.injected ? "Connect" : "—"}</i></button>
          <p>Eventra never stores your seed phrase or private key.</p>
        </div>
      ) : null}
    </div>
  );
}

export function walletStatusLabel(status: UseBrowserWalletResult["status"]): string {
  switch (status) {
    case "ready": return "Wallet ready · chain 50312";
    case "wrong_chain": return "Wrong network — switch to Somnia Shannon (50312)";
    case "connecting": return "Connecting wallet…";
    default: return "Wallet not connected";
  }
}
