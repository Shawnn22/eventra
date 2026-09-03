// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Forecast} from "./types/DreamPilotTypes.sol";
import {IForecastRegistry} from "./interfaces/IForecastRegistry.sol";

/// @title ForecastRegistry
/// @notice Immutable, signed AI forecast commitments tied to DreamDEX market IDs.
/// @dev Resolution is attested by authorized resolvers in v1; it is not a DreamDEX oracle.
contract ForecastRegistry is IForecastRegistry, EIP712, Ownable {
    using ECDSA for bytes32;

    bytes32 public constant FORECAST_TYPEHASH = keccak256(
        "Forecast(bytes32 marketId,bytes32 snapshotHash,bytes32 modelHash,uint16 probabilityYesBps,uint64 issuedAt,uint64 validUntil,uint256 nonce)"
    );

    struct Commitment {
        bytes32 marketId;
        bytes32 snapshotHash;
        bytes32 modelHash;
        address signer;
        uint16 probabilityYesBps;
        uint64 issuedAt;
        uint64 validUntil;
    }

    struct Resolution {
        bool resolved;
        bool yesWon;
        uint64 resolvedAt;
        address resolver;
    }

    mapping(address signer => bool) public forecastSigners;
    mapping(address resolver => bool) public resolvers;
    mapping(address signer => mapping(uint256 nonce => bool)) public nonceUsed;
    mapping(bytes32 digest => Commitment) public commitments;
    mapping(bytes32 marketId => Resolution) public resolutions;

    event ForecastSignerUpdated(address indexed signer, bool allowed);
    event ResolverUpdated(address indexed resolver, bool allowed);
    event ForecastCommitted(
        bytes32 indexed digest,
        bytes32 indexed marketId,
        bytes32 indexed modelHash,
        address signer,
        uint16 probabilityYesBps,
        bytes32 snapshotHash,
        uint64 issuedAt,
        uint64 validUntil
    );
    event MarketResolved(bytes32 indexed marketId, bool yesWon, address indexed resolver, uint64 resolvedAt);

    error UnauthorizedForecastSigner();
    error UnauthorizedResolver();
    error InvalidProbability();
    error InvalidTimeRange();
    error ForecastExpired();
    error NonceAlreadyUsed();
    error ForecastAlreadyCommitted();
    error MarketAlreadyResolved();
    error MarketNotResolved();
    error UnknownForecast();

    constructor(address initialOwner) EIP712("DreamPilotForecastRegistry", "1") Ownable(initialOwner) {}

    function setForecastSigner(address signer, bool allowed) external onlyOwner {
        forecastSigners[signer] = allowed;
        emit ForecastSignerUpdated(signer, allowed);
    }

    function setResolver(address resolver, bool allowed) external onlyOwner {
        resolvers[resolver] = allowed;
        emit ResolverUpdated(resolver, allowed);
    }

    function hashForecast(Forecast calldata forecast) external view returns (bytes32) {
        return _hashForecast(forecast);
    }

    function commitForecast(Forecast calldata forecast, bytes calldata signature) external returns (bytes32 digest) {
        if (forecast.probabilityYesBps > 10_000) revert InvalidProbability();
        if (forecast.issuedAt > block.timestamp || forecast.validUntil <= forecast.issuedAt) revert InvalidTimeRange();
        if (forecast.validUntil < block.timestamp) revert ForecastExpired();

        digest = _hashForecast(forecast);
        if (commitments[digest].signer != address(0)) revert ForecastAlreadyCommitted();
        address signer = digest.recover(signature);
        if (!forecastSigners[signer]) revert UnauthorizedForecastSigner();
        if (nonceUsed[signer][forecast.nonce]) revert NonceAlreadyUsed();
        if (resolutions[forecast.marketId].resolved) revert MarketAlreadyResolved();

        nonceUsed[signer][forecast.nonce] = true;
        commitments[digest] = Commitment({
            marketId: forecast.marketId,
            snapshotHash: forecast.snapshotHash,
            modelHash: forecast.modelHash,
            signer: signer,
            probabilityYesBps: forecast.probabilityYesBps,
            issuedAt: forecast.issuedAt,
            validUntil: forecast.validUntil
        });

        emit ForecastCommitted(
            digest,
            forecast.marketId,
            forecast.modelHash,
            signer,
            forecast.probabilityYesBps,
            forecast.snapshotHash,
            forecast.issuedAt,
            forecast.validUntil
        );
    }

    function resolveMarket(bytes32 marketId, bool yesWon) external {
        if (!resolvers[msg.sender]) revert UnauthorizedResolver();
        if (resolutions[marketId].resolved) revert MarketAlreadyResolved();
        resolutions[marketId] = Resolution(true, yesWon, uint64(block.timestamp), msg.sender);
        emit MarketResolved(marketId, yesWon, msg.sender, uint64(block.timestamp));
    }

    /// @return scoreE8 Brier score in [0, 100_000_000], where lower is better.
    function brierScore(bytes32 digest) external view returns (uint256 scoreE8, bool resolved) {
        Commitment memory commitment = commitments[digest];
        if (commitment.signer == address(0)) revert UnknownForecast();
        Resolution memory resolution = resolutions[commitment.marketId];
        if (!resolution.resolved) return (0, false);
        uint256 outcomeBps = resolution.yesWon ? 10_000 : 0;
        uint256 delta = commitment.probabilityYesBps > outcomeBps
            ? commitment.probabilityYesBps - outcomeBps
            : outcomeBps - commitment.probabilityYesBps;
        return (delta * delta, true);
    }

    function _hashForecast(Forecast calldata forecast) internal view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(
                abi.encode(
                    FORECAST_TYPEHASH,
                    forecast.marketId,
                    forecast.snapshotHash,
                    forecast.modelHash,
                    forecast.probabilityYesBps,
                    forecast.issuedAt,
                    forecast.validUntil,
                    forecast.nonce
                )
            )
        );
    }
}
