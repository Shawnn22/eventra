// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface IEventraAnalysisEscrow {
    enum RequestStatus {
        NONE,
        PENDING,
        FULFILLED,
        REFUNDED
    }

    struct ModelConfig {
        uint96 feeRaw;
        bool enabled;
    }

    struct AnalysisRequest {
        address user;
        bytes32 modelId;
        bytes32 requestHash;
        bytes32 reportHash;
        uint96 feeRaw;
        uint64 expiresAt;
        RequestStatus status;
    }

    function requestAnalysis(bytes32 modelId, bytes32 requestHash, uint64 expiresAt)
        external
        returns (bytes32 requestId);

    function fulfillAnalysis(bytes32 requestId, bytes32 reportHash) external;
    function refundFailedAnalysis(bytes32 requestId) external;
    function claimExpiredRefund(bytes32 requestId) external;
    function quote(bytes32 modelId) external view returns (uint96 feeRaw, bool enabled);
}
