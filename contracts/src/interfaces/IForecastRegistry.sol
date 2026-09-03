// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Forecast} from "../types/DreamPilotTypes.sol";

interface IForecastRegistry {
    function commitForecast(Forecast calldata forecast, bytes calldata signature) external returns (bytes32 digest);
    function hashForecast(Forecast calldata forecast) external view returns (bytes32);
    function brierScore(bytes32 digest) external view returns (uint256 scoreE8, bool resolved);
}
