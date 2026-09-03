# Eventra contracts

Three contracts for the Eventra AI-control layer:

- `DreamPilotGuard`: user policy, action permissions, per-order/daily limits and EIP-712 advice acceptance.
- `ForecastRegistry`: immutable signed forecast commitments and resolver-attested Brier scores.
- `EventraAnalysisEscrow`: ERC-20 pay-on-success escrow for AI reports. A fulfilled request anchors the report hash and releases the configured model fee; failed or expired requests refund the user.

The Guard and ForecastRegistry never hold funds. The AnalysisEscrow temporarily holds only the disclosed AI report fee. None of these contracts replaces DreamDEX markets, trading collateral, settlement, oracles, or order books.

```bash
forge install OpenZeppelin/openzeppelin-contracts@v5.2.0 --no-commit
forge install foundry-rs/forge-std --no-commit
echo '@openzeppelin/contracts/=lib/openzeppelin-contracts/contracts/' > remappings.txt
echo 'forge-std/=lib/forge-std/src/' >> remappings.txt
forge test -vvv
```

## Deploy to Somnia Shannon (chain 50312)

Copy `.env.example` to `.env`, provide a funded deployer and role addresses, then:

```bash
source .env
forge script script/DeployDreamPilot.s.sol:DeployDreamPilot \
  --rpc-url "$SOMNIA_RPC_URL" --broadcast -vvvv
```

The deployment script only deploys contracts. The final owner must separately call:

- `DreamPilotGuard.setAdviceSigner`
- `ForecastRegistry.setForecastSigner`
- `ForecastRegistry.setResolver`

This separation avoids silently granting roles when the deployer is not the production owner.

## Deploy the analysis-fee escrow separately

Set `ANALYSIS_PAYMENT_TOKEN` to the approved six-decimal testnet collateral token and `EVENTRA_TREASURY` to the fee recipient. Then run:

```bash
source .env
forge script script/DeployEventraAnalysisEscrow.s.sol:DeployEventraAnalysisEscrow \
  --rpc-url "$SOMNIA_RPC_URL" --broadcast -vvvv
```

After deployment, the final owner explicitly configures:

- `setFulfiller(serverSigner, true)` for the report-finalization service.
- `configureModel(modelId, feeRaw, true)` for each OpenRouter/Eventra model.

Recommended request lifecycle:

1. Hash the exact campaign snapshot, selected model and prompt version into `requestHash`.
2. User approves the disclosed token amount and calls `requestAnalysis` with a short expiry.
3. The server generates the report. On success it calls `fulfillAnalysis(requestId, reportHash)` and the escrow releases the fee.
4. The server calls `refundFailedAnalysis` on a terminal generation failure. If the server disappears, the user calls `claimExpiredRefund` after expiry.

Analysis fees and DreamDEX trade funds remain separate. The escrow does not place orders or custody trading collateral.
