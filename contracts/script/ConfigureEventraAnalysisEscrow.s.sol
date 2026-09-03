// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script} from "forge-std/Script.sol";
import {EventraAnalysisEscrow} from "../src/EventraAnalysisEscrow.sol";

contract ConfigureEventraAnalysisEscrow is Script {
    function run() external {
        uint256 ownerKey = vm.envUint("OWNER_PRIVATE_KEY");
        address fulfiller = vm.envAddress("ANALYSIS_FULFILLER");
        EventraAnalysisEscrow escrow = EventraAnalysisEscrow(vm.envAddress("ANALYSIS_ESCROW_ADDRESS"));

        vm.startBroadcast(ownerKey);
        escrow.setFulfiller(fulfiller, true);
        escrow.configureModel(keccak256("eventra-core"), 0, true);
        escrow.configureModel(keccak256("deepseek"), 20_000, true);
        escrow.configureModel(keccak256("chatgpt"), 30_000, true);
        escrow.configureModel(keccak256("claude"), 40_000, true);
        escrow.configureModel(keccak256("grok"), 50_000, true);
        escrow.configureModel(keccak256("surf"), 50_000, true);
        vm.stopBroadcast();
    }
}
