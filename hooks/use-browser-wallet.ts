"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Address, WalletClient } from "viem";
import {
  getInjectedProvider,
  getBrowserWalletProvider,
  getInjectedChainId,
  requestAccounts,
  switchToSomnia,
  createInjectedWalletClient,
  resolveWalletStatus,
  type WalletStatus,
  type BrowserWalletId,
} from "@/lib/wallet/browser-wallet";
import { SOMNIA_CHAIN_ID } from "@/lib/chain/somnia";

export type UseBrowserWalletResult = {
  status: WalletStatus;
  account: Address | null;
  chainId: number | null;
  walletClient: WalletClient | null;
  isReady: boolean;
  connect: (walletId?: BrowserWalletId) => Promise<void>;
  disconnect: () => void;
  switchChain: () => Promise<void>;
  onSessionInvalidated: (cb: () => void) => () => void;
};

export function useBrowserWallet(): UseBrowserWalletResult {
  const [status, setStatus] = useState<WalletStatus>("disconnected");
  const [account, setAccount] = useState<Address | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [walletClient, setWalletClient] = useState<WalletClient | null>(null);
  const invalidationListeners = useRef(new Set<() => void>());
  const prevAccountRef = useRef<Address | null>(null);
  const prevChainRef = useRef<number | null>(null);
  const activeProviderRef = useRef(getInjectedProvider());

  const notifyInvalidated = useCallback(() => {
    invalidationListeners.current.forEach((cb) => {
      try { cb(); } catch { /* ignore */ }
    });
  }, []);

  const onSessionInvalidated = useCallback((cb: () => void) => {
    invalidationListeners.current.add(cb);
    return () => { invalidationListeners.current.delete(cb); };
  }, []);

  const applyState = useCallback(
    (nextAccount: Address | null, nextChainId: number | null, connecting: boolean) => {
      const nextStatus = resolveWalletStatus(nextAccount, nextChainId, connecting);
      setAccount(nextAccount);
      setChainId(nextChainId);
      setStatus(nextStatus);
      if (nextStatus === "ready" && nextAccount) {
        const provider = activeProviderRef.current;
        setWalletClient(provider ? createInjectedWalletClient(provider, nextAccount) : null);
      } else {
        setWalletClient(null);
      }
      const accountChanged =
        prevAccountRef.current !== null &&
        nextAccount !== null &&
        prevAccountRef.current.toLowerCase() !== nextAccount.toLowerCase();
      const chainChanged =
        prevChainRef.current !== null &&
        nextChainId !== null &&
        prevChainRef.current !== nextChainId;
      const becameDisconnected = prevAccountRef.current !== null && nextAccount === null;
      if (accountChanged || chainChanged || becameDisconnected) notifyInvalidated();
      prevAccountRef.current = nextAccount;
      prevChainRef.current = nextChainId;
    },
    [notifyInvalidated],
  );

  const refresh = useCallback(async () => {
    const provider = getInjectedProvider();
    if (!provider) { applyState(null, null, false); return; }
    try {
      const [accounts, currentChain] = await Promise.all([
        provider.request({ method: "eth_accounts" }) as Promise<string[]>,
        getInjectedChainId(provider),
      ]);
      applyState(accounts?.[0] ? (accounts[0] as Address) : null, currentChain, false);
    } catch {
      applyState(null, null, false);
    }
  }, [applyState]);

  const connect = useCallback(async (walletId: BrowserWalletId = "injected") => {
    const selectedProvider = getBrowserWalletProvider(walletId);
    if (!selectedProvider) { applyState(null, null, false); return; }
    applyState(account, chainId, true);
    try {
      const provider = selectedProvider;
      activeProviderRef.current = provider;
      const addr = await requestAccounts(provider);
      if (!addr) { applyState(null, null, false); return; }
      let currentChain = await getInjectedChainId(provider);
      if (currentChain !== SOMNIA_CHAIN_ID) {
        if (await switchToSomnia(provider)) currentChain = await getInjectedChainId(provider);
      }
      applyState(addr, currentChain, false);
    } catch {
      applyState(null, null, false);
    }
  }, [account, chainId, applyState]);

  const switchChain = useCallback(async () => {
    const provider = activeProviderRef.current;
    if (!provider || !account) return;
    applyState(account, chainId, true);
    try {
      const ok = await switchToSomnia(provider);
      const currentChain = ok ? await getInjectedChainId(provider) : chainId;
      applyState(account, currentChain, false);
    } catch {
      applyState(account, chainId, false);
    }
  }, [account, chainId, applyState]);

  const disconnect = useCallback(() => {
    applyState(null, null, false);
    notifyInvalidated();
  }, [applyState, notifyInvalidated]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    void refresh();
    const provider = getInjectedProvider();
    if (!provider?.on) return;
    const onAccountsChanged = (accounts: unknown) => {
      const list = Array.isArray(accounts) ? (accounts as string[]) : [];
      const next = list[0] ? (list[0] as Address) : null;
      void getInjectedChainId(provider).then((cid) => applyState(next, cid, false));
    };
    const onChainChanged = (hex: unknown) => {
      const cid = typeof hex === "string" ? Number.parseInt(hex, 16) : null;
      void (async () => {
        const accounts = (await provider.request({ method: "eth_accounts" })) as string[];
        applyState(accounts?.[0] ? (accounts[0] as Address) : null, cid, false);
      })();
    };
    provider.on("accountsChanged", onAccountsChanged);
    provider.on("chainChanged", onChainChanged);
    return () => {
      provider.removeListener?.("accountsChanged", onAccountsChanged);
      provider.removeListener?.("chainChanged", onChainChanged);
    };
  }, [refresh, applyState]);

  return {
    status, account, chainId, walletClient,
    isReady: status === "ready",
    connect, disconnect, switchChain, onSessionInvalidated,
  };
}
