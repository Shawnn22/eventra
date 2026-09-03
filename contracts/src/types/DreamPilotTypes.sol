// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

enum AdviceAction {
    WAIT,
    BUY_YES,
    BUY_NO
}

struct UserPolicy {
    uint128 maxStakeRaw;
    uint128 dailyStakeLimitRaw;
    uint16 minConfidenceBps;
    uint32 maxAdviceAgeSec;
    bool allowBuyYes;
    bool allowBuyNo;
    bool enabled;
}

struct Advice {
    address user;
    bytes32 marketId;
    bytes32 snapshotHash;
    bytes32 modelHash;
    AdviceAction action;
    uint16 confidenceBps;
    uint128 stakeRaw;
    uint64 issuedAt;
    uint64 expiresAt;
    uint256 nonce;
}

struct Forecast {
    bytes32 marketId;
    bytes32 snapshotHash;
    bytes32 modelHash;
    uint16 probabilityYesBps;
    uint64 issuedAt;
    uint64 validUntil;
    uint256 nonce;
}
