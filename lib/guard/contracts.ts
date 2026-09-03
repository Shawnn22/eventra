import { parseAbi, type Address } from "viem";

export const DREAM_PILOT_GUARD_ADDRESS = "0xd2faBC3C9A096cEe10FC75e67f351E579B91EC38" as Address;
export const FORECAST_REGISTRY_ADDRESS = "0x3a88155FeA234FCda46cffD3B5a059DA4Fa52F7e" as Address;

export const dreamPilotGuardAbi = parseAbi([
  "function owner() view returns (address)",
  "function policies(address user) view returns (uint128 maxStakeRaw, uint128 dailyStakeLimitRaw, uint16 minConfidenceBps, uint32 maxAdviceAgeSec, bool allowBuyYes, bool allowBuyNo, bool enabled)",
  "function marketAllowed(address user, bytes32 marketId) view returns (bool)",
  "function setPolicy((uint128 maxStakeRaw, uint128 dailyStakeLimitRaw, uint16 minConfidenceBps, uint32 maxAdviceAgeSec, bool allowBuyYes, bool allowBuyNo, bool enabled) policy)",
  "function setMarketAllowed(bytes32 marketId, bool allowed)",
]);

export const forecastRegistryAbi = parseAbi([
  "function owner() view returns (address)",
  "function forecastSigners(address signer) view returns (bool)",
  "function commitments(bytes32 digest) view returns (bytes32 marketId, bytes32 snapshotHash, bytes32 modelHash, address signer, uint16 probabilityYesBps, uint64 issuedAt, uint64 validUntil)",
  "function commitForecast((bytes32 marketId, bytes32 snapshotHash, bytes32 modelHash, uint16 probabilityYesBps, uint64 issuedAt, uint64 validUntil, uint256 nonce) forecast, bytes signature) returns (bytes32 digest)",
]);

export const forecastTypes = {
  Forecast: [
    { name: "marketId", type: "bytes32" },
    { name: "snapshotHash", type: "bytes32" },
    { name: "modelHash", type: "bytes32" },
    { name: "probabilityYesBps", type: "uint16" },
    { name: "issuedAt", type: "uint64" },
    { name: "validUntil", type: "uint64" },
    { name: "nonce", type: "uint256" },
  ],
} as const;
