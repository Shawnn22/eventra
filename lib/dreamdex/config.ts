import { SOMNIA_TESTNET_ADDRESSES } from "@somnia-chain/markets-sdk";
import { somniaShannonTestnet } from "@/lib/chain/somnia";

export const DREAMDEX_BROWSER = {
  chainId: 50312 as const,
  chain: somniaShannonTestnet,
  indexerUrl: process.env.NEXT_PUBLIC_DREAMDEX_INDEXER_URL ?? "https://dev.smk.somnia.host/v1/graphql",
  wsRpcUrl: process.env.NEXT_PUBLIC_SOMNIA_WS_RPC_URL ?? "wss://dream-rpc.somnia.network/ws",
  httpRpcUrl: process.env.NEXT_PUBLIC_SOMNIA_HTTP_RPC_URL ?? "https://dream-rpc.somnia.network",
  venueId: process.env.NEXT_PUBLIC_DREAMDEX_VENUE_ID ?? "0x1a1e6821cde7d0159c0d293177871e09677b4e42307c7db3ba94f8648a5a050f",
  fallbackVenueId: process.env.NEXT_PUBLIC_DREAMDEX_FALLBACK_VENUE_ID ?? "0x679795a0195a1b76cdebb7c51d74e058aee92919b8c3389af86ef24535e8a28c",
  addresses: SOMNIA_TESTNET_ADDRESSES,
  collateral: SOMNIA_TESTNET_ADDRESSES.testUsdc as `0x${string}`,
} as const;

const allowedPools = new Set(
  (process.env.NEXT_PUBLIC_DREAMDEX_ALLOWED_POOLS ?? "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean),
);

export function isLiveTradingEnabled(): boolean {
  return process.env.NEXT_PUBLIC_ENABLE_LIVE_TRADING !== "false";
}

export function isAllowedDreamDexPool(pool: string): boolean {
  return isLiveTradingEnabled() && (allowedPools.size === 0 || allowedPools.has(pool.toLowerCase()));
}
