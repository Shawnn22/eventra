// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {EventraAnalysisEscrow} from "../src/EventraAnalysisEscrow.sol";

/// @notice Separate deployment prevents accidental redeployment of Guard and ForecastRegistry.
contract DeployEventraAnalysisEscrow is Script {
    function run() external returns (EventraAnalysisEscrow escrow) {
        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address owner = vm.envAddress("DREAMPILOT_OWNER");
        address paymentToken = vm.envAddress("ANALYSIS_PAYMENT_TOKEN");
        address treasury = vm.envAddress("EVENTRA_TREASURY");

        vm.startBroadcast(deployerKey);
        escrow = new EventraAnalysisEscrow(owner, IERC20(paymentToken), treasury);
        vm.stopBroadcast();
    }
}
