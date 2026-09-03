// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {DreamPilotGuard} from "../src/DreamPilotGuard.sol";
import {Advice, AdviceAction, UserPolicy} from "../src/types/DreamPilotTypes.sol";

contract DreamPilotGuardTest is Test {
    DreamPilotGuard internal guard;
    uint256 internal signerKey = 0xA11CE;
    address internal signer;
    address internal user = address(0xBEEF);
    bytes32 internal marketId = keccak256("dreamdex-market");

    function setUp() external {
        signer = vm.addr(signerKey);
        guard = new DreamPilotGuard(address(this));
        guard.setAdviceSigner(signer, true);
        vm.startPrank(user);
        guard.setPolicy(
            UserPolicy({
                maxStakeRaw: 100e6,
                dailyStakeLimitRaw: 200e6,
                minConfidenceBps: 6_000,
                maxAdviceAgeSec: 15 minutes,
                allowBuyYes: true,
                allowBuyNo: false,
                enabled: true
            })
        );
        guard.setMarketAllowed(marketId, true);
        vm.stopPrank();
    }

    function testAcceptValidBuyYesAndTrackDailyLimit() external {
        Advice memory advice = _advice(AdviceAction.BUY_YES, 7_000, 75e6, 1);
        bytes memory signature = _sign(advice);
        vm.prank(user);
        bytes32 digest = guard.acceptAdvice(advice, signature);
        assertEq(guard.acceptedBy(digest), user);
        assertTrue(guard.nonceUsed(user, 1));
        assertEq(guard.remainingDailyStake(user), 125e6);
    }

    function testRejectDisallowedAction() external {
        Advice memory advice = _advice(AdviceAction.BUY_NO, 7_000, 10e6, 2);
        bytes memory signature = _sign(advice);
        vm.expectRevert(DreamPilotGuard.ActionNotAllowed.selector);
        vm.prank(user);
        guard.acceptAdvice(advice, signature);
    }

    function testRejectDailyLimitExceeded() external {
        Advice memory first = _advice(AdviceAction.BUY_YES, 7_000, 100e6, 3);
        bytes memory firstSignature = _sign(first);
        vm.prank(user);
        guard.acceptAdvice(first, firstSignature);
        Advice memory second = _advice(AdviceAction.BUY_YES, 7_000, 100e6, 4);
        bytes memory secondSignature = _sign(second);
        vm.prank(user);
        guard.acceptAdvice(second, secondSignature);
        Advice memory third = _advice(AdviceAction.BUY_YES, 7_000, 1, 5);
        bytes memory thirdSignature = _sign(third);
        vm.expectRevert(DreamPilotGuard.DailyStakeLimitExceeded.selector);
        vm.prank(user);
        guard.acceptAdvice(third, thirdSignature);
    }

    function testWaitDoesNotConsumeLimit() external {
        Advice memory advice = _advice(AdviceAction.WAIT, 0, 0, 6);
        bytes memory signature = _sign(advice);
        vm.prank(user);
        guard.acceptAdvice(advice, signature);
        assertEq(guard.remainingDailyStake(user), 200e6);
    }

    function testRejectReplay() external {
        Advice memory advice = _advice(AdviceAction.BUY_YES, 7_000, 10e6, 7);
        bytes memory signature = _sign(advice);
        vm.prank(user);
        guard.acceptAdvice(advice, signature);
        vm.expectRevert(DreamPilotGuard.AdviceAlreadyAccepted.selector);
        vm.prank(user);
        guard.acceptAdvice(advice, signature);
    }

    function testOnlyOwnerCanManageSigner() external {
        vm.expectRevert();
        vm.prank(user);
        guard.setAdviceSigner(user, true);
    }

    function testMalformedSignatureReturnsValidationFailure() external view {
        Advice memory advice = _advice(AdviceAction.BUY_YES, 7_000, 10e6, 8);
        (bool ok, bytes32 reason) = guard.validateAdvice(advice, hex"1234");
        assertFalse(ok);
        assertEq(reason, bytes32("UnauthorizedAdviceSigner"));
    }

    function testRejectInvalidPolicyConfiguration() external {
        vm.expectRevert(DreamPilotGuard.InvalidDailyLimit.selector);
        vm.prank(user);
        guard.setPolicy(
            UserPolicy({
                maxStakeRaw: 100e6,
                dailyStakeLimitRaw: 99e6,
                minConfidenceBps: 6_000,
                maxAdviceAgeSec: 15 minutes,
                allowBuyYes: true,
                allowBuyNo: true,
                enabled: true
            })
        );
    }

    function _advice(AdviceAction action, uint16 confidence, uint128 stake, uint256 nonce)
        internal
        view
        returns (Advice memory)
    {
        return Advice({
            user: user,
            marketId: marketId,
            snapshotHash: keccak256("snapshot"),
            modelHash: keccak256("model"),
            action: action,
            confidenceBps: confidence,
            stakeRaw: stake,
            issuedAt: uint64(block.timestamp),
            expiresAt: uint64(block.timestamp + 10 minutes),
            nonce: nonce
        });
    }

    function _sign(Advice memory advice) internal view returns (bytes memory) {
        bytes32 digest = guard.hashAdvice(advice);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(signerKey, digest);
        return abi.encodePacked(r, s, v);
    }
}
