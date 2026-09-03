import "server-only";

import {
  SomniaMarkets,
  SOMNIA_TESTNET_ADDRESSES,
  type BinaryMarket,
} from "@somnia-chain/markets-sdk";
import { somniaTestnet } from "viem/chains";

export const DREAMDEX_TESTNET = {
  chainId: 50312,
  indexerUrl:
    process.env.DREAMDEX_INDEXER_URL ?? "https://dev.smk.somnia.host/v1/graphql",
  wsRpcUrl:
    process.env.SOMNIA_WS_RPC_URL ??
    "wss://dream-rpc.somnia.network/ws",
  venueId:
    process.env.DREAMDEX_VENUE_ID ??
    "0x1a1e6821cde7d0159c0d293177871e09677b4e42307c7db3ba94f8648a5a050f",
} as const;

export type DreamDexMarketSnapshot = {
  marketId: string;
  poolAddress: string;
  venueId: string;
  asset: "BTC" | "ETH";
  question: string;
  horizon: "1m" | "5m" | "10m" | "15m" | "45m" | "1h" | "4h";
  intervalSec: number;
  expiry: string;
  minutesRemaining: number;
  probabilityUp: number | null;
  volumeUsd: number;
  tradeCount: number;
  lastTradeAt: string | null;
};

const horizonBySeconds: Record<number, DreamDexMarketSnapshot["horizon"]> = {
  60: "1m",
  300: "5m",
  600: "10m",
  900: "15m",
  2700: "45m",
  3600: "1h",
  14400: "4h",
};

function toSnapshot(market: BinaryMarket): DreamDexMarketSnapshot | null {
  const asset = market.asset.toUpperCase();
  const intervalSec = Number(market.intervalSec);
  const horizon = horizonBySeconds[intervalSec];
  if ((asset !== "BTC" && asset !== "ETH") || !horizon) return null;

  const scale = 10 ** market.quoteDecimals;
  const expirySeconds = Number(market.expiry);

  return {
    marketId: market.marketId,
    poolAddress: market.poolAddress,
    venueId: market.venueId ?? DREAMDEX_TESTNET.venueId,
    asset,
    question: market.question,
    horizon,
    intervalSec,
    expiry: new Date(expirySeconds * 1000).toISOString(),
    minutesRemaining: Math.max(
      0,
      Math.ceil((expirySeconds * 1000 - Date.now()) / 60_000),
    ),
    probabilityUp: market.lastPrice
      ? Number(((Number(market.lastPrice) / scale) * 100).toFixed(2))
      : null,
    volumeUsd: Number((Number(market.cumulativeQuoteVolume) / scale).toFixed(2)),
    tradeCount: Number(market.tradeCount),
    lastTradeAt: market.lastTradeAt,
  };
}

export async function fetchDreamDexMarkets(filters: {
  asset?: "BTC" | "ETH";
  horizon?: DreamDexMarketSnapshot["horizon"];
  signal?: AbortSignal;
}) {
  const intervalSec = filters.horizon
    ? Number(
        Object.entries(horizonBySeconds).find(
          ([, horizon]) => horizon === filters.horizon,
        )?.[0],
      )
    : undefined;

  const exchange = new SomniaMarkets({
    indexerUrl: DREAMDEX_TESTNET.indexerUrl,
    chain: somniaTestnet,
    wsRpcUrl: DREAMDEX_TESTNET.wsRpcUrl,
    addresses: SOMNIA_TESTNET_ADDRESSES,
    signal: filters.signal,
  });

  const rows = await exchange.client.listBinaryMarkets({
    venueId: DREAMDEX_TESTNET.venueId,
    status: "Trading",
    orderBy: "newest",
    asset: filters.asset,
    intervalSec: Number.isFinite(intervalSec) ? intervalSec : undefined,
    limit: 20,
  });

  const snapshots = rows
    .map(toSnapshot)
    .filter((market): market is DreamDexMarketSnapshot => Boolean(market))
    .filter((market) => market.minutesRemaining > 0);

  // The indexer can briefly lag behind the canonical market registry. Never
  // surface a campaign as tradable until its pool, collateral, status and
  // expiry have also been confirmed on-chain.
  const verifySnapshot = async (snapshot: DreamDexMarketSnapshot) => {
      let market: Awaited<ReturnType<typeof exchange.client.getMarketOnchain>>;
      try {
        market = await exchange.client.getMarketOnchain(snapshot.marketId as `0x${string}`);
      } catch {
        // The public Somnia WebSocket RPC can reject a burst of parallel reads.
        // Retry once after a short backoff before declaring the campaign
        // unavailable; never bypass the on-chain safety gate.
        await new Promise((resolve) => setTimeout(resolve, 250));
        market = await exchange.client.getMarketOnchain(snapshot.marketId as `0x${string}`);
      }
      const poolMatches =
        market.pool.toLowerCase() === snapshot.poolAddress.toLowerCase();
      const expectedCollateral = SOMNIA_TESTNET_ADDRESSES.testUsdc;
      const collateralMatches = Boolean(expectedCollateral) &&
        market.collateral.toLowerCase() === expectedCollateral!.toLowerCase();
      const trading = market.status === 1;
      const notExpired = Number(market.expiry) * 1000 > Date.now();

      return poolMatches && collateralMatches && trading && notExpired
        ? snapshot
        : null;
  };
  const verified: PromiseSettledResult<DreamDexMarketSnapshot | null>[] = [];
  for (let index = 0; index < snapshots.length; index += 2) {
    const batch = snapshots.slice(index, index + 2);
    verified.push(...await Promise.allSettled(batch.map(verifySnapshot)));
  }

  const markets = verified.flatMap((result) =>
    result.status === "fulfilled" && result.value ? [result.value] : [],
  );
  return {
    markets,
    diagnostics: {
      indexedTradingMarkets: rows.length,
      supportedOpenMarkets: snapshots.length,
      onchainVerifiedMarkets: markets.length,
      verificationFailures: verified.filter((result) => result.status === "rejected").length,
      rejectedByOnchainState: verified.filter((result) => result.status === "fulfilled" && !result.value).length,
    },
  };
}

export async function verifyDreamDexMarketOnchain(params: {
  marketId: `0x${string}`;
  expectedPool: `0x${string}`;
}) {
  const exchange = new SomniaMarkets({
    indexerUrl: DREAMDEX_TESTNET.indexerUrl,
    chain: somniaTestnet,
    wsRpcUrl: DREAMDEX_TESTNET.wsRpcUrl,
    addresses: SOMNIA_TESTNET_ADDRESSES,
  });
  const market = await exchange.client.getMarketOnchain(params.marketId);
  const poolMatches = market.pool.toLowerCase() === params.expectedPool.toLowerCase();
  const expectedCollateral = SOMNIA_TESTNET_ADDRESSES.testUsdc;
  const collateralMatches = Boolean(expectedCollateral) && market.collateral.toLowerCase() === expectedCollateral!.toLowerCase();
  const trading = market.status === 1;
  const notExpired = Number(market.expiry) * 1000 > Date.now();
  return {
    verified: poolMatches && collateralMatches && trading && notExpired,
    poolMatches,
    collateralMatches,
    trading,
    notExpired,
    marketAddress: market.marketAddress,
    pool: market.pool,
    collateral: market.collateral,
    outcomeToken: market.outcomeToken,
    status: market.status,
    expiry: market.expiry.toString(),
    nonce: market.nonce.toString(),
  };
}

export async function resolveDreamDexMarketOutcomes(marketIds: `0x${string}`[]) {
  const exchange = new SomniaMarkets({
    indexerUrl: DREAMDEX_TESTNET.indexerUrl,
    chain: somniaTestnet,
    wsRpcUrl: DREAMDEX_TESTNET.wsRpcUrl,
    addresses: SOMNIA_TESTNET_ADDRESSES,
  });

  const uniqueIds = [...new Set(marketIds)].slice(0, 20);
  const reads = await Promise.allSettled(uniqueIds.map(async (marketId) => {
    const market = await exchange.client.getMarketOnchain(marketId);
    return {
      marketId,
      status: market.status,
      expiry: market.expiry.toString(),
      finalized: market.finalized,
      isResolved: market.isResolved,
      isVoided: market.isVoided,
      winningOutcome: market.isResolved && (market.winningOutcome === 0 || market.winningOutcome === 1)
        ? market.winningOutcome as 0 | 1
        : null,
    };
  }));

  return reads.map((read, index) => read.status === "fulfilled"
    ? read.value
    : {
        marketId: uniqueIds[index],
        status: null,
        expiry: null,
        finalized: false,
        isResolved: false,
        isVoided: false,
        winningOutcome: null,
        unavailable: true,
      });
}
