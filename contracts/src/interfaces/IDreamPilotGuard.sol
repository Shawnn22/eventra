// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;
import {Advice, UserPolicy} from "../types/DreamPilotTypes.sol";

interface IDreamPilotGuard {
    function setPolicy(UserPolicy calldata policy) external;
    function setMarketAllowed(bytes32 marketId, bool allowed) external;
    function setAdviceSigner(address signer, bool allowed) external;
    function hashAdvice(Advice calldata advice) external view returns (bytes32);
    function validateAdvice(Advice calldata advice, bytes calldata signature)
        external
        view
        returns (bool ok, bytes32 reason);
    function acceptAdvice(Advice calldata advice, bytes calldata signature) external returns (bytes32 digest);
    function remainingDailyStake(address user) external view returns (uint128);
}
