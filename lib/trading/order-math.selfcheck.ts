import {
  assertSizingInvariants,
  limitPriceWithSlippage,
  probabilityPercentToPrice,
  sizeBuyFromCollateral,
} from "./order-math";
import { ONE_BASE } from "./order-schema";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const collateral = 50_000_000n;
for (const pct of [1, 50, 99] as const) {
  const price = probabilityPercentToPrice(pct);
  const { quantityRaw, maxEscrowRaw } = sizeBuyFromCollateral(collateral, price);
  assert(quantityRaw > 0n, `qty > 0 at ${pct}%`);
  assert(assertSizingInvariants(collateral, price), `invariants at ${pct}%`);
  const limit = limitPriceWithSlippage(price, 100);
  assert(limit >= price, `slippage raises limit at ${pct}%`);
  assert(limit < ONE_BASE, `limit < 1.0 at ${pct}%`);
  console.log(`OK ${pct}% price=${price} qty=${quantityRaw} escrow=${maxEscrowRaw}`);
}

const tick = 10_000n;
const alignedLimit = limitPriceWithSlippage(430_000n, 100, ONE_BASE, tick);
assert(alignedLimit === 440_000n, "buy limit rounds up to the next pool tick");
assert(alignedLimit % tick === 0n, "limit is tick aligned");
const lot = 10_000n;
const lotSized = sizeBuyFromCollateral(1_000_000n, alignedLimit, 6, lot);
assert(lotSized.quantityRaw % lot === 0n, "quantity is lot aligned");
console.log("order-math selfcheck passed");
