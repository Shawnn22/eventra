"use client";

import { useCallback, useEffect, useState } from "react";
import type { Address, Hex } from "viem";
import { hidekiTestnet } from "@somnia-chain/markets-sdk/chains";
import { getInjectedProvider, type BrowserProvider } from "@/lib/wallet/browser-wallet";

type PerpsWalletStatus = "disconnected" | "connecting" | "wrong_chain" | "ready";

const HIDEKI_CHAIN_HEX = `0x${hidekiTestnet.id.toString(16)}` as Hex;

const providerError = (error: unknown) => {
  if (typeof error === "object" && error && "message" in error && typeof (error as { message?: unknown }).message === "string") return (error as { message: string }).message;
  return "Wallet could not switch to Hideki";
};

async function switchToHideki(provider: BrowserProvider) {
  const network = {
    chainId: HIDEKI_CHAIN_HEX,
    chainName: hidekiTestnet.name,
    nativeCurrency: hidekiTestnet.nativeCurrency,
    rpcUrls: [...hidekiTestnet.rpcUrls.default.http],
  };

  try {
    // Hideki currently has no public block explorer. Omitting the optional field
    // is required because OKX rejects an empty blockExplorerUrls array.
    await provider.request({ method: "wallet_addEthereumChain", params: [network] });
  } catch (addError) {
    const code = typeof addError === "object" && addError && "code" in addError ? Number((addError as { code: unknown }).code) : null;
    if (code === 4001) return { ok: false as const, error: "Adding Hideki Testnet was rejected in the wallet." };
    // Some wallets reject wallet_addEthereumChain when the network already
    // exists. Continue to switching instead of blocking the user.
  }

  try {
    await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: HIDEKI_CHAIN_HEX }] });
    return { ok: true as const, error: null };
  } catch (switchError) {
    return { ok: false as const, error: providerError(switchError) };
  }
}

export function usePerpsWallet() {
  const [account, setAccount] = useState<Address | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [status, setStatus] = useState<PerpsWalletStatus>("disconnected");
  const [error, setError] = useState<string>("");

  const sync = useCallback(async (connecting = false) => {
    const provider = getInjectedProvider();
    if (!provider) { setStatus("disconnected"); return; }
    if (connecting) setStatus("connecting");
    const [accounts, chainHex] = await Promise.all([
      provider.request({ method: "eth_accounts" }) as Promise<string[]>,
      provider.request({ method: "eth_chainId" }) as Promise<string>,
    ]);
    const nextAccount = accounts[0] ? accounts[0] as Address : null;
    const nextChainId = Number.parseInt(chainHex, 16);
    setAccount(nextAccount);
    setChainId(nextChainId);
    setStatus(!nextAccount ? "disconnected" : nextChainId === hidekiTestnet.id ? "ready" : "wrong_chain");
  }, []);

  const connect = useCallback(async () => {
    const provider = getInjectedProvider();
    if (!provider) return;
    setStatus("connecting");
    setError("");
    try {
      await provider.request({ method: "eth_requestAccounts" });
      const chainHex = await provider.request({ method: "eth_chainId" }) as string;
      if (Number.parseInt(chainHex, 16) !== hidekiTestnet.id) {
        const result = await switchToHideki(provider);
        if (!result.ok) setError(result.error);
      }
      await sync();
    } catch (connectError) {
      setError(providerError(connectError));
      await sync();
    }
  }, [sync]);

  const switchChain = useCallback(async () => {
    const provider = getInjectedProvider();
    if (!provider) return;
    setStatus("connecting");
    setError("");
    const result = await switchToHideki(provider);
    if (!result.ok) {
      setError(result.error);
      await sync();
      return;
    }
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const chainHex = await provider.request({ method: "eth_chainId" }) as string;
      if (Number.parseInt(chainHex, 16) === hidekiTestnet.id) break;
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    await sync();
  }, [sync]);

  useEffect(() => {
    const provider = getInjectedProvider();
    void sync();
    if (!provider?.on) return;
    const refresh = () => { void sync(); };
    provider.on("accountsChanged", refresh);
    provider.on("chainChanged", refresh);
    return () => {
      provider.removeListener?.("accountsChanged", refresh);
      provider.removeListener?.("chainChanged", refresh);
    };
  }, [sync]);

  return { account, chainId, status, error, isReady: status === "ready", connect, switchChain };
}
