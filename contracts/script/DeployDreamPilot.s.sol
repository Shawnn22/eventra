// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script} from "forge-std/Script.sol";
import {DreamPilotGuard} from "../src/DreamPilotGuard.sol";
import {ForecastRegistry} from "../src/ForecastRegistry.sol";

contract DeployDreamPilot is Script {
    function run() external returns (DreamPilotGuard guard, ForecastRegistry registry) {
        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address owner = vm.envAddress("DREAMPILOT_OWNER");
        vm.startBroadcast(deployerKey);
        guard = new DreamPilotGuard(owner);
        registry = new ForecastRegistry(owner);
        vm.stopBroadcast();
    }
}
