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
  fallbackVenueId:
    process.env.DREAMDEX_FALLBACK_VENUE_ID ??
    "0x679795a0195a1b76cdebb7c51d74e058aee92919b8c3389af86ef24535e8a28c",
} as const;

export const DREAMDEX_TESTNET_VENUE_IDS = [
  ...new Set([DREAMDEX_TESTNET.venueId, DREAMDEX_TESTNET.fallbackVenueId]),
];

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

const INDEXER_READ_ATTEMPTS = 3;
const LAST_GOOD_SCAN_TTL_MS = 120_000;
let lastGoodScan: { markets: DreamDexMarketSnapshot[]; cachedAt: number } | null = null;

const horizonBySeconds: Record<number, DreamDexMarketSnapshot["horizon"]> = {
  60: "1m",
  300: "5m",
  600: "10m",
  900: "15m",
  2700: "45m",
  3600: "1h",
  14400: "4h",
};

function toSnapshot(market: BinaryMarket, queriedVenueId: string): DreamDexMarketSnapshot | null {
  const asset = market.asset.toUpperCase();
  const intervalSec = Number(market.intervalSec);
  const horizon = horizonBySeconds[intervalSec];
  if ((asset !== "BTC" && asset !== "ETH") || !horizon) return null;

  const scale = 10 ** market.quoteDecimals;
  const expirySeconds = Number(market.expiry);

  return {
    marketId: market.marketId,
    poolAddress: market.poolAddress,
    venueId: market.venueId ?? queriedVenueId,
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

  const listVenueMarkets = async (venueId: string) => {
    let lastError: unknown;
    for (let attempt = 1; attempt <= INDEXER_READ_ATTEMPTS; attempt += 1) {
      try {
        return await exchange.client.listBinaryMarkets({
          venueId,
          status: "Trading",
          orderBy: "newest",
          asset: filters.asset,
          intervalSec: Number.isFinite(intervalSec) ? intervalSec : undefined,
          limit: 20,
        });
      } catch (error) {
        lastError = error;
        if (filters.signal?.aborted || attempt === INDEXER_READ_ATTEMPTS) break;
        await new Promise((resolve) => setTimeout(resolve, attempt * 350));
      }
    }
    throw lastError ?? new Error(`DreamDEX venue ${venueId} could not be read.`);
  };

  const readLastGoodScan = (reason: "indexer_unavailable" | "rpc_unavailable") => {
    if (!lastGoodScan || Date.now() - lastGoodScan.cachedAt > LAST_GOOD_SCAN_TTL_MS) return null;
    const markets = lastGoodScan.markets.filter(
      (market) => new Date(market.expiry).getTime() > Date.now(),
    );
    if (markets.length === 0) return null;
    return {
      markets,
      diagnostics: {
        indexedTradingMarkets: 0,
        supportedOpenMarkets: markets.length,
        onchainVerifiedMarkets: markets.length,
        queriedVenueIds: DREAMDEX_TESTNET_VENUE_IDS,
        failedVenueScans: DREAMDEX_TESTNET_VENUE_IDS.length,
        verificationFailures: 0,
        rejectedByOnchainState: 0,
        freshness: "last_good" as const,
        staleAgeMs: Date.now() - lastGoodScan.cachedAt,
        fallbackReason: reason,
      },
    };
  };

  const venueScans = await Promise.allSettled(
    DREAMDEX_TESTNET_VENUE_IDS.map(async (venueId) => ({
      venueId,
      rows: await listVenueMarkets(venueId),
    })),
  );
  const successfulScans = venueScans.flatMap((result) =>
    result.status === "fulfilled" ? [result.value] : [],
  );
  if (successfulScans.length === 0) {
    const cached = readLastGoodScan("indexer_unavailable");
    if (cached) return cached;
    const failure = venueScans.find(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    throw failure?.reason ?? new Error("DreamDEX venue scans failed.");
  }

  const rows = successfulScans.flatMap(({ venueId, rows: venueRows }) =>
    venueRows.map((market) => ({ market, queriedVenueId: venueId })),
  );
  const snapshots = rows
    .map(({ market, queriedVenueId }) => toSnapshot(market, queriedVenueId))
    .filter((market): market is DreamDexMarketSnapshot => Boolean(market))
    .filter((market) => market.minutesRemaining > 0)
    .filter(
      (market, index, all) =>
        all.findIndex((candidate) => candidate.marketId === market.marketId) === index,
    );

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
  if (markets.length === 0 && verified.some((result) => result.status === "rejected")) {
    const cached = readLastGoodScan("rpc_unavailable");
    if (cached) return cached;
  }
  if (markets.length > 0) lastGoodScan = { markets, cachedAt: Date.now() };
  return {
    markets,
    diagnostics: {
      indexedTradingMarkets: rows.length,
      supportedOpenMarkets: snapshots.length,
      onchainVerifiedMarkets: markets.length,
      queriedVenueIds: DREAMDEX_TESTNET_VENUE_IDS,
      failedVenueScans: venueScans.filter((result) => result.status === "rejected").length,
      verificationFailures: verified.filter((result) => result.status === "rejected").length,
      rejectedByOnchainState: verified.filter((result) => result.status === "fulfilled" && !result.value).length,
      freshness: "live" as const,
      staleAgeMs: 0,
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
