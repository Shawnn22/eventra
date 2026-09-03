// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IEventraAnalysisEscrow} from "./interfaces/IEventraAnalysisEscrow.sol";

/// @title EventraAnalysisEscrow
/// @notice Pay-on-success escrow for AI reports. Trading funds never enter this contract.
/// @dev A fulfilled request anchors the report hash and releases only the configured model fee.
contract EventraAnalysisEscrow is IEventraAnalysisEscrow, Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant MAX_REQUEST_TTL = 1 days;

    IERC20 public immutable paymentToken;
    address public treasury;

    mapping(bytes32 modelId => ModelConfig) public models;
    mapping(address fulfiller => bool) public fulfillers;
    mapping(address user => uint256 nonce) public nonces;
    mapping(bytes32 requestId => AnalysisRequest) public requests;

    event TreasuryUpdated(address indexed previousTreasury, address indexed newTreasury);
    event FulfillerUpdated(address indexed fulfiller, bool allowed);
    event ModelConfigured(bytes32 indexed modelId, uint96 feeRaw, bool enabled);
    event AnalysisRequested(
        bytes32 indexed requestId,
        address indexed user,
        bytes32 indexed modelId,
        bytes32 requestHash,
        uint96 feeRaw,
        uint64 expiresAt
    );
    event AnalysisFulfilled(
        bytes32 indexed requestId, address indexed user, bytes32 indexed modelId, bytes32 reportHash, uint96 feeRaw
    );
    event AnalysisRefunded(bytes32 indexed requestId, address indexed user, uint96 feeRaw, bool expired);

    error ZeroAddress();
    error UnknownOrDisabledModel();
    error InvalidRequestHash();
    error InvalidReportHash();
    error InvalidExpiry();
    error UnknownRequest();
    error RequestNotPending();
    error RequestExpired();
    error RequestNotExpired();
    error UnauthorizedFulfiller();
    error WrongUser();
    error UnsupportedTokenBehavior();

    constructor(address initialOwner, IERC20 token, address initialTreasury) Ownable(initialOwner) {
        if (address(token) == address(0) || initialTreasury == address(0)) revert ZeroAddress();
        paymentToken = token;
        treasury = initialTreasury;
    }

    function setTreasury(address newTreasury) external onlyOwner {
        if (newTreasury == address(0)) revert ZeroAddress();
        address previousTreasury = treasury;
        treasury = newTreasury;
        emit TreasuryUpdated(previousTreasury, newTreasury);
    }

    function setFulfiller(address fulfiller, bool allowed) external onlyOwner {
        if (fulfiller == address(0)) revert ZeroAddress();
        fulfillers[fulfiller] = allowed;
        emit FulfillerUpdated(fulfiller, allowed);
    }

    function configureModel(bytes32 modelId, uint96 feeRaw, bool enabled) external onlyOwner {
        if (modelId == bytes32(0)) revert UnknownOrDisabledModel();
        models[modelId] = ModelConfig(feeRaw, enabled);
        emit ModelConfigured(modelId, feeRaw, enabled);
    }

    function quote(bytes32 modelId) external view returns (uint96 feeRaw, bool enabled) {
        ModelConfig memory model = models[modelId];
        return (model.feeRaw, model.enabled);
    }

    function requestAnalysis(bytes32 modelId, bytes32 requestHash, uint64 expiresAt)
        external
        nonReentrant
        returns (bytes32 requestId)
    {
        ModelConfig memory model = models[modelId];
        if (!model.enabled) revert UnknownOrDisabledModel();
        if (requestHash == bytes32(0)) revert InvalidRequestHash();
        if (expiresAt <= block.timestamp || expiresAt > block.timestamp + MAX_REQUEST_TTL) revert InvalidExpiry();

        uint256 nonce = nonces[msg.sender]++;
        requestId = keccak256(abi.encode(msg.sender, nonce, modelId, requestHash, address(this), block.chainid));
        requests[requestId] = AnalysisRequest({
            user: msg.sender,
            modelId: modelId,
            requestHash: requestHash,
            reportHash: bytes32(0),
            feeRaw: model.feeRaw,
            expiresAt: expiresAt,
            status: RequestStatus.PENDING
        });

        if (model.feeRaw != 0) {
            uint256 balanceBefore = paymentToken.balanceOf(address(this));
            paymentToken.safeTransferFrom(msg.sender, address(this), model.feeRaw);
            if (paymentToken.balanceOf(address(this)) != balanceBefore + model.feeRaw) {
                revert UnsupportedTokenBehavior();
            }
        }

        emit AnalysisRequested(requestId, msg.sender, modelId, requestHash, model.feeRaw, expiresAt);
    }

    function fulfillAnalysis(bytes32 requestId, bytes32 reportHash) external nonReentrant {
        if (!fulfillers[msg.sender]) revert UnauthorizedFulfiller();
        if (reportHash == bytes32(0)) revert InvalidReportHash();
        AnalysisRequest storage request = _pendingRequest(requestId);
        if (block.timestamp > request.expiresAt) revert RequestExpired();

        request.reportHash = reportHash;
        request.status = RequestStatus.FULFILLED;
        uint96 feeRaw = request.feeRaw;
        if (feeRaw != 0) paymentToken.safeTransfer(treasury, feeRaw);

        emit AnalysisFulfilled(requestId, request.user, request.modelId, reportHash, feeRaw);
    }

    function refundFailedAnalysis(bytes32 requestId) external nonReentrant {
        if (!fulfillers[msg.sender]) revert UnauthorizedFulfiller();
        AnalysisRequest storage request = _pendingRequest(requestId);
        _refund(requestId, request, false);
    }

    function claimExpiredRefund(bytes32 requestId) external nonReentrant {
        AnalysisRequest storage request = _pendingRequest(requestId);
        if (msg.sender != request.user) revert WrongUser();
        if (block.timestamp <= request.expiresAt) revert RequestNotExpired();
        _refund(requestId, request, true);
    }

    function _pendingRequest(bytes32 requestId) internal view returns (AnalysisRequest storage request) {
        request = requests[requestId];
        if (request.status == RequestStatus.NONE) revert UnknownRequest();
        if (request.status != RequestStatus.PENDING) revert RequestNotPending();
    }

    function _refund(bytes32 requestId, AnalysisRequest storage request, bool expired) internal {
        request.status = RequestStatus.REFUNDED;
        uint96 feeRaw = request.feeRaw;
        if (feeRaw != 0) paymentToken.safeTransfer(request.user, feeRaw);
        emit AnalysisRefunded(requestId, request.user, feeRaw, expired);
    }
}
