export type PerpsSide = "LONG" | "SHORT";

export type PerpsRiskInput = {
  side: PerpsSide;
  markPrice: number;
  entryPrice: number;
  collateral: number;
  leverage: number;
  stopLoss: number;
  takeProfit: number;
  maintenanceMarginRate?: number;
};

export type PerpsRiskSnapshot = {
  notional: number;
  quantity: number;
  liquidationPrice: number;
  liquidationDistancePct: number;
  riskAmount: number;
  rewardAmount: number;
  riskRewardRatio: number;
  marginUsagePct: number;
  health: "SAFE" | "CAUTION" | "DANGER";
};

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

export function calculatePerpsRisk(input: PerpsRiskInput): PerpsRiskSnapshot {
  // dreamDEX 20x Perps markets currently use 5% initial and 2.5%
  // maintenance margin. Keep this overrideable for lower-leverage markets.
  const maintenance = input.maintenanceMarginRate ?? 0.025;
  const leverage = clamp(input.leverage, 1, 50);
  const collateral = Math.max(0, input.collateral);
  const notional = collateral * leverage;
  const quantity = input.entryPrice > 0 ? notional / input.entryPrice : 0;
  const direction = input.side === "LONG" ? 1 : -1;
  const liquidationMove = Math.max(0, 1 / leverage - maintenance);
  const liquidationPrice = Math.max(
    0,
    input.entryPrice * (1 - direction * liquidationMove),
  );
  const liquidationDistancePct = input.markPrice > 0
    ? Math.abs(input.markPrice - liquidationPrice) / input.markPrice * 100
    : 0;
  const stopMove = Math.max(
    0,
    direction * (input.entryPrice - input.stopLoss),
  );
  const targetMove = Math.max(
    0,
    direction * (input.takeProfit - input.entryPrice),
  );
  const riskAmount = stopMove * quantity;
  const rewardAmount = targetMove * quantity;
  const riskRewardRatio = riskAmount > 0 ? rewardAmount / riskAmount : 0;
  const marginUsagePct = collateral > 0 ? Math.min(100, notional / (collateral * 20) * 100) : 0;
  const health = liquidationDistancePct < 4
    ? "DANGER"
    : liquidationDistancePct < 9 || riskRewardRatio < 1.25
      ? "CAUTION"
      : "SAFE";

  return {
    notional,
    quantity,
    liquidationPrice,
    liquidationDistancePct,
    riskAmount,
    rewardAmount,
    riskRewardRatio,
    marginUsagePct,
    health,
  };
}
