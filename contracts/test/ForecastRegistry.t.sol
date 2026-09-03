// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {ForecastRegistry} from "../src/ForecastRegistry.sol";
import {Forecast} from "../src/types/DreamPilotTypes.sol";

contract ForecastRegistryTest is Test {
    ForecastRegistry internal registry;
    uint256 internal signerKey = 0xF0CA57;
    address internal signer;
    address internal resolver = address(0xCAFE);

    function setUp() external {
        signer = vm.addr(signerKey);
        registry = new ForecastRegistry(address(this));
        registry.setForecastSigner(signer, true);
        registry.setResolver(resolver, true);
    }

    function testCommitResolveAndScore() external {
        Forecast memory forecast = _forecast(6_500, 1);
        bytes32 digest = registry.commitForecast(forecast, _sign(forecast));
        vm.prank(resolver);
        registry.resolveMarket(forecast.marketId, true);
        (uint256 score, bool resolved) = registry.brierScore(digest);
        assertTrue(resolved);
        assertEq(score, 12_250_000); // (10,000 - 6,500)^2
    }

    function testRejectUnauthorizedSignature() external {
        Forecast memory forecast = _forecast(5_000, 2);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(0xBAD, registry.hashForecast(forecast));
        vm.expectRevert(ForecastRegistry.UnauthorizedForecastSigner.selector);
        registry.commitForecast(forecast, abi.encodePacked(r, s, v));
    }

    function testRejectNonceReplayAcrossForecasts() external {
        Forecast memory first = _forecast(5_000, 3);
        registry.commitForecast(first, _sign(first));
        Forecast memory second = first;
        second.probabilityYesBps = 5_001;
        bytes memory secondSignature = _sign(second);
        vm.expectRevert(ForecastRegistry.NonceAlreadyUsed.selector);
        registry.commitForecast(second, secondSignature);
    }

    function testUnresolvedScoreIsExplicit() external {
        Forecast memory forecast = _forecast(5_000, 4);
        bytes32 digest = registry.commitForecast(forecast, _sign(forecast));
        (uint256 score, bool resolved) = registry.brierScore(digest);
        assertEq(score, 0);
        assertFalse(resolved);
    }

    function _forecast(uint16 probability, uint256 nonce) internal view returns (Forecast memory) {
        return Forecast({
            marketId: keccak256("dreamdex-market"),
            snapshotHash: keccak256("snapshot"),
            modelHash: keccak256("model-version-prompt"),
            probabilityYesBps: probability,
            issuedAt: uint64(block.timestamp),
            validUntil: uint64(block.timestamp + 1 hours),
            nonce: nonce
        });
    }

    function _sign(Forecast memory forecast) internal view returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(signerKey, registry.hashForecast(forecast));
        return abi.encodePacked(r, s, v);
    }
}
