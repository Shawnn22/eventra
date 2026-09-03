// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script} from "forge-std/Script.sol";
import {DreamPilotGuard} from "../src/DreamPilotGuard.sol";
import {ForecastRegistry} from "../src/ForecastRegistry.sol";

contract ConfigureRoles is Script {
    function run() external {
        uint256 ownerKey = vm.envUint("OWNER_PRIVATE_KEY");
        DreamPilotGuard guard = DreamPilotGuard(vm.envAddress("DREAMPILOT_GUARD_ADDRESS"));
        ForecastRegistry registry = ForecastRegistry(vm.envAddress("FORECAST_REGISTRY_ADDRESS"));
        address adviceSigner = vm.envAddress("ADVICE_SIGNER");
        address forecastSigner = vm.envAddress("FORECAST_SIGNER");
        address resolver = vm.envAddress("DREAMDEX_RESOLVER");

        vm.startBroadcast(ownerKey);
        guard.setAdviceSigner(adviceSigner, true);
        registry.setForecastSigner(forecastSigner, true);
        registry.setResolver(resolver, true);
        vm.stopBroadcast();
    }
}
