import assert from "node:assert/strict";
import { SomniaMarkets } from "@somnia-chain/markets-sdk";
import { hidekiTestnet } from "@somnia-chain/markets-sdk/chains";
import { calculatePerpsRisk } from "../lib/perps/risk-engine";
import { runPerpsPreflight } from "../lib/perps/browser-preflight";
import { buildPerpsAIDecision } from "../lib/perps/ai-decision";
import { formatPerpsWalletError } from "../lib/perps/wallet-error";
import { buildPerpsClosePlan } from "../lib/perps/browser-close";
import { calculatePerpsTechnicalSnapshot } from "../lib/perps/technical-indicators";

const HIDEKI_INDEXER = "https://hideki-dev.smk.somnia.host/v1/graphql";
const EMPTY_ACCOUNT = "0x0000000000000000000000000000000000000001" as const;

const longRisk = calculatePerpsRisk({
  side: "LONG",
  markPrice: 100,
  entryPrice: 100,
  collateral: 100,
  leverage: 5,
  stopLoss: 98,
  takeProfit: 104,
});
assert.equal(longRisk.notional, 500);
assert.equal(longRisk.quantity, 5);
assert.equal(longRisk.riskAmount, 10);
assert.equal(longRisk.rewardAmount, 20);
assert.equal(longRisk.riskRewardRatio, 2);
assert.equal(longRisk.health, "SAFE");

const shortRisk = calculatePerpsRisk({
  side: "SHORT",
  markPrice: 100,
  entryPrice: 100,
  collateral: 100,
  leverage: 10,
  stopLoss: 102,
  takeProfit: 96,
});
assert.equal(shortRisk.notional, 1_000);
assert.equal(shortRisk.quantity, 10);
assert.equal(shortRisk.riskAmount, 20);
assert.equal(shortRisk.rewardAmount, 40);
assert.equal(shortRisk.riskRewardRatio, 2);

const aiLong = buildPerpsAIDecision({
  symbol: "BTC-PERP",
  price: 103,
  change: 1.2,
  funding: 0,
  openInterest: 10,
  tradeCount: 12,
  candles: Array.from({ length: 30 }, (_, index) => ({ open: 100 + index * .1, high: 100.2 + index * .1, low: 99.9 + index * .1, close: 100.1 + index * .1, volume: 1, trades: 1 })),
});
assert.equal(aiLong.side, "LONG");
assert.ok(aiLong.confidence >= 52);
assert.equal(aiLong.drivers.length, 3);
assert.match(aiLong.invalidation, /Reassess/);
const technical = calculatePerpsTechnicalSnapshot(Array.from({ length: 30 }, (_, index) => ({ open: 100 + index, high: 101.5 + index, low: 99.5 + index, close: 101 + index, volume: 10 + index, trades: 1 })));
assert.equal(technical.regime, "TRENDING_UP");
assert.ok(technical.ema9 > technical.ema21);
assert.ok(technical.rsi14 > 70);
assert.ok(technical.resistance > technical.support);
assert.match(formatPerpsWalletError(Object.assign(new Error("User rejected the request"), { code: 4001 }), "signing"), /Resume/);

const closeLong = buildPerpsClosePlan({ signedSize: 20_000n, percentage: 50, lotSize: 10_000n, markPrice: 8_166_649n, tickSize: 10n });
assert.equal(closeLong.isBid, false);
assert.equal(closeLong.quantity, 10_000n);
assert.ok(closeLong.price < 8_166_649n);

const closeShort = buildPerpsClosePlan({ signedSize: -20_000n, percentage: 100, lotSize: 10_000n, markPrice: 8_166_649n, tickSize: 10n });
assert.equal(closeShort.isBid, true);
assert.equal(closeShort.quantity, 20_000n);
assert.ok(closeShort.price > 8_166_649n);
assert.throws(() => buildPerpsClosePlan({ signedSize: 10_000n, percentage: 25, lotSize: 10_000n, markPrice: 100n, tickSize: 1n }), /minimum lot/);

async function main() {
  const exchange = new SomniaMarkets({ chain: hidekiTestnet, indexerUrl: HIDEKI_INDEXER });
  try {
    const markets = await exchange.client.listPerpMarkets({ limit: 100 });
    const market = markets.find((item) => item.baseSymbol === "BTC") ?? markets[0];
    assert.ok(market?.poolAddress, "Hideki must return at least one Perps market");
    const candles = await exchange.client.getCandles(market.poolAddress, 60, { market: market.id, limit: 30 });
    assert.ok(candles.length >= 2, "The selected Perps market must return chartable one-minute OHLCV");
    assert.ok(candles.every(candle => Number(candle.closePrice) > 0), "Every chart candle must have a positive close");

    const preflight = await runPerpsPreflight({
      account: EMPTY_ACCOUNT,
      poolAddress: market.poolAddress,
      side: "LONG",
      quantity: 0.001,
    });
    assert.equal(preflight.market.endsWith("-PERP"), true);
    assert.equal(preflight.placeable, false);
    assert.ok(preflight.reason, "An unfunded account must be rejected with a reason");
    assert.ok(BigInt(preflight.asOfBlock) > 0n);

    console.log(JSON.stringify({
      riskEngine: "pass",
      hidekiIndexer: "pass",
      liveOhlcv: `${candles.length} candles`,
      failClosedPreflight: "pass",
      aiDecision: "pass",
      technicalIndicators: "pass",
      walletErrorRecovery: "pass",
      reduceOnlyClosePlan: "pass",
      market: preflight.market,
      reason: preflight.reason,
      block: preflight.asOfBlock,
    }, null, 2));
  } finally {
    await exchange.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
