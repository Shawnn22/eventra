import {
  createWalletClient,
  createPublicClient,
  custom,
  http,
  type Address,
  type WalletClient,
  type PublicClient,
  type Hex,
} from "viem";
import { somniaShannonTestnet, SOMNIA_CHAIN_ID } from "@/lib/chain/somnia";

export type WalletStatus = "disconnected" | "connecting" | "wrong_chain" | "ready";

export type BrowserProvider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  on?: (event: string, handler: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, handler: (...args: unknown[]) => void) => void;
  providers?: BrowserProvider[];
  isMetaMask?: boolean;
  isOkxWallet?: boolean;
  isOKExWallet?: boolean;
};

export type BrowserWalletId = "metamask" | "okx" | "injected";

declare global {
  interface Window {
    ethereum?: BrowserProvider;
    okxwallet?: BrowserProvider;
  }
}

export function hasInjectedProvider(): boolean {
  return typeof window !== "undefined" && Boolean(window.ethereum);
}

export function getInjectedProvider(): BrowserProvider | null {
  if (typeof window === "undefined") return null;
  return window.ethereum ?? null;
}

export function getBrowserWalletProvider(id: BrowserWalletId): BrowserProvider | null {
  if (typeof window === "undefined") return null;
  if (id === "okx" && window.okxwallet) return window.okxwallet;
  const injected = getInjectedProvider();
  if (!injected) return null;
  const providers = injected.providers?.length ? injected.providers : [injected];
  if (id === "metamask") return providers.find((provider) => provider.isMetaMask && !provider.isOkxWallet && !provider.isOKExWallet) ?? null;
  if (id === "okx") return providers.find((provider) => provider.isOkxWallet || provider.isOKExWallet) ?? null;
  return injected;
}

export function detectBrowserWallets(): Record<BrowserWalletId, boolean> {
  return {
    metamask: Boolean(getBrowserWalletProvider("metamask")),
    okx: Boolean(typeof window !== "undefined" && (window.okxwallet || getBrowserWalletProvider("okx"))),
    injected: hasInjectedProvider(),
  };
}

export async function getInjectedChainId(
  provider: BrowserProvider = getInjectedProvider()!,
): Promise<number | null> {
  if (!provider) return null;
  try {
    const hex = (await provider.request({ method: "eth_chainId" })) as Hex;
    return Number.parseInt(hex, 16);
  } catch {
    return null;
  }
}

export async function requestAccounts(
  provider: BrowserProvider = getInjectedProvider()!,
): Promise<Address | null> {
  if (!provider) return null;
  try {
    const accounts = (await provider.request({ method: "eth_requestAccounts" })) as string[];
    const first = accounts?.[0];
    return first ? (first as Address) : null;
  } catch {
    return null;
  }
}

export async function switchToSomnia(
  provider: BrowserProvider = getInjectedProvider()!,
): Promise<boolean> {
  if (!provider) return false;
  const chainIdHex = `0x${SOMNIA_CHAIN_ID.toString(16)}` as Hex;
  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: chainIdHex }],
    });
    return true;
  } catch (err: unknown) {
    const code =
      typeof err === "object" && err !== null && "code" in err
        ? (err as { code: number }).code
        : null;
    if (code === 4902 || code === -32603) {
      try {
        await provider.request({
          method: "wallet_addEthereumChain",
          params: [
            {
              chainId: chainIdHex,
              chainName: somniaShannonTestnet.name,
              nativeCurrency: somniaShannonTestnet.nativeCurrency,
              rpcUrls: [...somniaShannonTestnet.rpcUrls.default.http],
              blockExplorerUrls: [somniaShannonTestnet.blockExplorers.default.url],
            },
          ],
        });
        return true;
      } catch {
        return false;
      }
    }
    return false;
  }
}

export function createInjectedWalletClient(
  provider: BrowserProvider,
  account: Address,
): WalletClient {
  return createWalletClient({
    account,
    chain: somniaShannonTestnet,
    transport: custom(provider),
  });
}

export function createSomniaPublicClient(): PublicClient {
  return createPublicClient({
    chain: somniaShannonTestnet,
    transport: http(somniaShannonTestnet.rpcUrls.default.http[0]),
  });
}

export function resolveWalletStatus(
  account: Address | null,
  chainId: number | null,
  connecting: boolean,
): WalletStatus {
  if (connecting) return "connecting";
  if (!account) return "disconnected";
  if (chainId !== SOMNIA_CHAIN_ID) return "wrong_chain";
  return "ready";
}
