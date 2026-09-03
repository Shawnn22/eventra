// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IDreamPilotGuard} from "./interfaces/IDreamPilotGuard.sol";
import {Advice, AdviceAction, UserPolicy} from "./types/DreamPilotTypes.sol";

/// @title DreamPilotGuard — non-custodial advice provenance (no funds, no arbitrary calls)
contract DreamPilotGuard is IDreamPilotGuard, EIP712, Ownable {
    using ECDSA for bytes32;

    bytes32 public constant ADVICE_TYPEHASH = keccak256(
        "Advice(address user,bytes32 marketId,bytes32 snapshotHash,bytes32 modelHash,uint8 action,uint16 confidenceBps,uint128 stakeRaw,uint64 issuedAt,uint64 expiresAt,uint256 nonce)"
    );

    mapping(address user => UserPolicy) public policies;
    mapping(address user => mapping(bytes32 marketId => bool)) public marketAllowed;
    mapping(address signer => bool) public adviceSigners;
    mapping(bytes32 adviceDigest => address accepter) public acceptedBy;
    mapping(address user => mapping(uint256 nonce => bool)) public nonceUsed;
    mapping(address user => mapping(uint256 day => uint128 stakeRaw)) public dailyStakeUsed;

    event PolicyUpdated(address indexed user, UserPolicy policy);
    event MarketPermissionUpdated(address indexed user, bytes32 indexed marketId, bool allowed);
    event AdviceSignerUpdated(address indexed signer, bool allowed);
    event AdviceAccepted(
        bytes32 indexed digest,
        address indexed user,
        bytes32 indexed marketId,
        AdviceAction action,
        uint128 stakeRaw,
        bytes32 modelHash,
        bytes32 snapshotHash
    );

    error PolicyDisabled();
    error MarketNotAllowed();
    error UnauthorizedAdviceSigner();
    error AdviceExpired();
    error AdviceTooOld();
    error FutureAdvice();
    error NonceAlreadyUsed();
    error StakeAbovePolicy();
    error ConfidenceBelowPolicy();
    error InvalidConfidence();
    error InvalidDailyLimit();
    error ActionNotAllowed();
    error DailyStakeLimitExceeded();
    error InvalidWaitStake();
    error InvalidBuyStake();
    error WrongUser();
    error AdviceAlreadyAccepted();

    constructor(address initialOwner) EIP712("DreamPilotGuard", "1") Ownable(initialOwner) {}

    function setPolicy(UserPolicy calldata policy) external {
        if (policy.minConfidenceBps > 10_000) revert InvalidConfidence();
        if (policy.dailyStakeLimitRaw != 0 && policy.dailyStakeLimitRaw < policy.maxStakeRaw) {
            revert InvalidDailyLimit();
        }
        policies[msg.sender] = policy;
        emit PolicyUpdated(msg.sender, policy);
    }

    function setMarketAllowed(bytes32 marketId, bool allowed) external {
        marketAllowed[msg.sender][marketId] = allowed;
        emit MarketPermissionUpdated(msg.sender, marketId, allowed);
    }

    function setAdviceSigner(address signer, bool allowed) external onlyOwner {
        adviceSigners[signer] = allowed;
        emit AdviceSignerUpdated(signer, allowed);
    }

    function hashAdvice(Advice calldata advice) external view returns (bytes32) {
        return _hashAdvice(advice);
    }

    function validateAdvice(Advice calldata advice, bytes calldata signature)
        external
        view
        returns (bool ok, bytes32 reason)
    {
        return _validate(advice, signature);
    }

    function acceptAdvice(Advice calldata advice, bytes calldata signature) external returns (bytes32 digest) {
        if (msg.sender != advice.user) revert WrongUser();
        (bool ok, bytes32 reason) = _validate(advice, signature);
        if (!ok) {
            if (reason == bytes32("PolicyDisabled")) revert PolicyDisabled();
            if (reason == bytes32("MarketNotAllowed")) revert MarketNotAllowed();
            if (reason == bytes32("UnauthorizedAdviceSigner")) revert UnauthorizedAdviceSigner();
            if (reason == bytes32("AdviceExpired")) revert AdviceExpired();
            if (reason == bytes32("AdviceTooOld")) revert AdviceTooOld();
            if (reason == bytes32("FutureAdvice")) revert FutureAdvice();
            if (reason == bytes32("NonceAlreadyUsed")) revert NonceAlreadyUsed();
            if (reason == bytes32("StakeAbovePolicy")) revert StakeAbovePolicy();
            if (reason == bytes32("ConfidenceBelowPolicy")) revert ConfidenceBelowPolicy();
            if (reason == bytes32("InvalidConfidence")) revert InvalidConfidence();
            if (reason == bytes32("ActionNotAllowed")) revert ActionNotAllowed();
            if (reason == bytes32("DailyStakeLimitExceeded")) revert DailyStakeLimitExceeded();
            if (reason == bytes32("InvalidWaitStake")) revert InvalidWaitStake();
            if (reason == bytes32("InvalidBuyStake")) revert InvalidBuyStake();
            if (reason == bytes32("AdviceAlreadyAccepted")) revert AdviceAlreadyAccepted();
            revert UnauthorizedAdviceSigner();
        }
        digest = _hashAdvice(advice);
        nonceUsed[advice.user][advice.nonce] = true;
        acceptedBy[digest] = msg.sender;
        if (advice.action != AdviceAction.WAIT) {
            dailyStakeUsed[advice.user][_currentDay()] += advice.stakeRaw;
        }
        emit AdviceAccepted(
            digest, advice.user, advice.marketId, advice.action, advice.stakeRaw, advice.modelHash, advice.snapshotHash
        );
    }

    function remainingDailyStake(address user) external view returns (uint128) {
        UserPolicy memory policy = policies[user];
        if (policy.dailyStakeLimitRaw == 0) return type(uint128).max;
        uint128 used = dailyStakeUsed[user][_currentDay()];
        return used >= policy.dailyStakeLimitRaw ? 0 : policy.dailyStakeLimitRaw - used;
    }

    function _hashAdvice(Advice calldata advice) internal view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(
                abi.encode(
                    ADVICE_TYPEHASH,
                    advice.user,
                    advice.marketId,
                    advice.snapshotHash,
                    advice.modelHash,
                    uint8(advice.action),
                    advice.confidenceBps,
                    advice.stakeRaw,
                    advice.issuedAt,
                    advice.expiresAt,
                    advice.nonce
                )
            )
        );
    }

    function _validate(Advice calldata advice, bytes calldata signature)
        internal
        view
        returns (bool ok, bytes32 reason)
    {
        UserPolicy memory policy = policies[advice.user];
        if (!policy.enabled) return (false, bytes32("PolicyDisabled"));
        if (!marketAllowed[advice.user][advice.marketId]) return (false, bytes32("MarketNotAllowed"));
        bytes32 digest = _hashAdvice(advice);
        if (acceptedBy[digest] != address(0)) return (false, bytes32("AdviceAlreadyAccepted"));
        if (nonceUsed[advice.user][advice.nonce]) return (false, bytes32("NonceAlreadyUsed"));
        (address recovered, ECDSA.RecoverError recoverError,) = ECDSA.tryRecover(digest, signature);
        if (recoverError != ECDSA.RecoverError.NoError || !adviceSigners[recovered]) {
            return (false, bytes32("UnauthorizedAdviceSigner"));
        }
        if (advice.issuedAt > block.timestamp) return (false, bytes32("FutureAdvice"));
        if (advice.expiresAt < block.timestamp) return (false, bytes32("AdviceExpired"));
        if (block.timestamp > uint256(advice.issuedAt) + uint256(policy.maxAdviceAgeSec)) {
            return (false, bytes32("AdviceTooOld"));
        }
        if (advice.confidenceBps > 10_000) return (false, bytes32("InvalidConfidence"));
        if (advice.action == AdviceAction.WAIT) {
            if (advice.stakeRaw != 0) return (false, bytes32("InvalidWaitStake"));
        } else {
            if (advice.action == AdviceAction.BUY_YES && !policy.allowBuyYes) {
                return (false, bytes32("ActionNotAllowed"));
            }
            if (advice.action == AdviceAction.BUY_NO && !policy.allowBuyNo) {
                return (false, bytes32("ActionNotAllowed"));
            }
            if (advice.stakeRaw == 0) return (false, bytes32("InvalidBuyStake"));
            if (advice.stakeRaw > policy.maxStakeRaw) return (false, bytes32("StakeAbovePolicy"));
            if (advice.confidenceBps < policy.minConfidenceBps) return (false, bytes32("ConfidenceBelowPolicy"));
            if (policy.dailyStakeLimitRaw != 0) {
                uint128 used = dailyStakeUsed[advice.user][_currentDay()];
                if (uint256(used) + advice.stakeRaw > policy.dailyStakeLimitRaw) {
                    return (false, bytes32("DailyStakeLimitExceeded"));
                }
            }
        }
        return (true, bytes32(0));
    }

    function _currentDay() internal view returns (uint256) {
        return block.timestamp / 1 days;
    }
}
