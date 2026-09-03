// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {EventraAnalysisEscrow} from "../src/EventraAnalysisEscrow.sol";
import {IEventraAnalysisEscrow} from "../src/interfaces/IEventraAnalysisEscrow.sol";

contract MockUSDC is ERC20 {
    constructor() ERC20("Test USDC", "tUSDC") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract EventraAnalysisEscrowTest is Test {
    EventraAnalysisEscrow internal escrow;
    MockUSDC internal token;
    address internal user = address(0xA11CE);
    address internal fulfiller = address(0xF011);
    address internal treasury = address(0x7EA5);
    bytes32 internal modelId = keccak256("openrouter:anthropic/claude-sonnet");
    uint96 internal fee = 250_000; // 0.25 USDC with six decimals.

    function setUp() external {
        token = new MockUSDC();
        escrow = new EventraAnalysisEscrow(address(this), token, treasury);
        escrow.configureModel(modelId, fee, true);
        escrow.setFulfiller(fulfiller, true);
        token.mint(user, 10_000_000);
        vm.prank(user);
        token.approve(address(escrow), type(uint256).max);
    }

    function testPayOnlyAfterSuccessfulReport() external {
        bytes32 requestId = _request();
        assertEq(token.balanceOf(treasury), 0);
        assertEq(token.balanceOf(address(escrow)), fee);

        bytes32 reportHash = keccak256("report-json");
        vm.prank(fulfiller);
        escrow.fulfillAnalysis(requestId, reportHash);

        assertEq(token.balanceOf(treasury), fee);
        assertEq(token.balanceOf(address(escrow)), 0);
        (,,, bytes32 storedReportHash,,, IEventraAnalysisEscrow.RequestStatus status) = escrow.requests(requestId);
        assertEq(storedReportHash, reportHash);
        assertEq(uint256(status), uint256(IEventraAnalysisEscrow.RequestStatus.FULFILLED));
    }

    function testUserClaimsExpiredRefund() external {
        uint256 balanceBefore = token.balanceOf(user);
        bytes32 requestId = _request();
        vm.warp(block.timestamp + 16 minutes);
        vm.prank(user);
        escrow.claimExpiredRefund(requestId);
        assertEq(token.balanceOf(user), balanceBefore);
        assertEq(token.balanceOf(address(escrow)), 0);
    }

    function testFulfillerCanRefundFailedReportBeforeExpiry() external {
        uint256 balanceBefore = token.balanceOf(user);
        bytes32 requestId = _request();
        vm.prank(fulfiller);
        escrow.refundFailedAnalysis(requestId);
        assertEq(token.balanceOf(user), balanceBefore);
    }

    function testRejectUnauthorizedFulfillment() external {
        bytes32 requestId = _request();
        vm.expectRevert(EventraAnalysisEscrow.UnauthorizedFulfiller.selector);
        escrow.fulfillAnalysis(requestId, keccak256("report"));
    }

    function testRejectLateFulfillmentAndPreserveRefund() external {
        bytes32 requestId = _request();
        vm.warp(block.timestamp + 16 minutes);
        vm.prank(fulfiller);
        vm.expectRevert(EventraAnalysisEscrow.RequestExpired.selector);
        escrow.fulfillAnalysis(requestId, keccak256("late-report"));
        vm.prank(user);
        escrow.claimExpiredRefund(requestId);
        assertEq(token.balanceOf(address(escrow)), 0);
    }

    function testRejectDisabledModel() external {
        escrow.configureModel(modelId, fee, false);
        vm.prank(user);
        vm.expectRevert(EventraAnalysisEscrow.UnknownOrDisabledModel.selector);
        escrow.requestAnalysis(modelId, keccak256("request"), uint64(block.timestamp + 15 minutes));
    }

    function _request() internal returns (bytes32 requestId) {
        vm.prank(user);
        requestId = escrow.requestAnalysis(
            modelId, keccak256("market-snapshot-and-prompt"), uint64(block.timestamp + 15 minutes)
        );
    }
}
