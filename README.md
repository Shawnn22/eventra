# Eventra

Eventra is an AI decision and execution copilot for DreamDEX on Somnia. The repository contains two connected product surfaces:

- **Event Contracts** — AI-assisted UP/DOWN/WAIT research and wallet-controlled execution.
- **Perps** — live market evidence, position-risk simulation, wallet execution and partial/full position closing.

The Perps bounty demo is available at [`/perps`](https://evantra-ai.vercel.app/perps).

## DreamDEX Perps bounty flow

`Live market → AI decision brief → Risk simulation → On-chain preflight → Open position → Monitor PnL → Close 25% / 50% / all`

- Network: **Hideki Testnet**, chain ID `50383`.
- SDK: `@somnia-chain/markets-sdk` `0.32.1`.
- Markets: live DreamDEX Perps indexed from the official Hideki v2 endpoint.
- Collateral: wallet USDso with STT used for gas.
- Execution remains non-custodial: Eventra never signs or submits an order without the connected wallet.
- Close requests refetch the position, cap quantity to the current size, check executable liquidity and simulate the exact calldata before opening the wallet.

## Why it exists

Prediction-market odds answer “what is the market pricing?” but not “is this an executable decision for me?”. Eventra combines:

- DreamDEX campaign state, order-book evidence and settlement timing.
- Live BTC/ETH spot context and explainable technical evidence.
- Model-selectable AI analysis with a visible fee before generation.
- Wallet-controlled DreamDEX execution and position management.
- Verifiable forecast and payment records on Somnia.

## Demo modes

Eventra never presents simulated activity as a real transaction.

| Mode | Purpose | Funds |
| --- | --- | --- |
| **DreamDEX Live** | Uses supported, unexpired DreamDEX campaigns and on-chain quotes | Requires Somnia testnet wallet and TestUSDC |
| **Test Arena** | Always-available judge flow when DreamDEX has no open campaign | Simulation only; no wallet transaction |

The app automatically scans for eligible DreamDEX campaigns. When none are open, Test Arena remains available so judges can still complete the AI report and order experience.

## Product flow

1. **Discover** — rank available campaigns by data quality, liquidity and time remaining.
2. **Choose AI** — select Eventra Core or a configured external provider.
3. **Review fee** — show the analysis price before report generation.
4. **Analyze** — return Quick Predict, key indicators, AI verdict, confidence, invalidation and deep research.
5. **Execute** — review UP/DOWN price, size and payout; the connected wallet approves the on-chain action.
6. **Manage** — inspect receipts, open orders and positions; request an exit quote when liquidity exists.

## AI providers

- **Eventra Core** works without an API key and is the reliable hackathon demo path.
- Grok, Surf, DeepSeek, ChatGPT and Claude are selectable product frames. They become executable only when their server-side provider configuration is available.
- `OPENROUTER_API_KEY` enables configured OpenRouter-backed models through the server route. Keys are never exposed through `NEXT_PUBLIC_*` variables.

## DreamDEX and Somnia integration

- DreamDEX SDK: `@somnia-chain/markets-sdk` `0.32.1`.
- Network: Somnia Shannon testnet, chain ID `50312`.
- Event Contract data: DreamDEX indexer plus on-chain market verification.
- HTTP RPC: `https://dream-rpc.somnia.network/`.
- WebSocket RPC: `wss://dream-rpc.somnia.network/ws`.
- Spot reference: Coinbase public OHLCV; DreamDEX remains the source for Event Contract odds and execution.

Live execution is fail-closed: a campaign must be explicitly supported, unexpired, in the correct on-chain state and included in the configured pool allowlist.

## Deployed contracts

| Contract | Purpose | Somnia Shannon address |
| --- | --- | --- |
| `DreamPilotGuard` | User policy and EIP-712 advice acceptance | [`0xd2fa...EC38`](https://shannon-explorer.somnia.network/address/0xd2faBC3C9A096cEe10FC75e67f351E579B91EC38) |
| `ForecastRegistry` | Signed forecast commitments and resolver-attested scores | [`0x3a88...2F7e`](https://shannon-explorer.somnia.network/address/0x3a88155FeA234FCda46cffD3B5a059DA4Fa52F7e) |
| `EventraAnalysisEscrow` | Pay-on-success AI report fee with expiry refund | [`0xc4a0...ec8C`](https://shannon-explorer.somnia.network/address/0xc4a0e9fB3f004392c22cA4d666f8756E9e99ec8C) |

These contracts complement DreamDEX; they do not replace its order book, collateral, market oracle or settlement.

## Run locally

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open `http://localhost:3000`.

Open `http://localhost:3000/perps` for the DreamDEX Perps bounty demo.

Eventra Core and Test Arena work without paid AI credentials. Configure only the integrations you intend to demonstrate.

## Verification

```bash
npm run typecheck
npm run test:perps
npm run build
cd contracts && forge test
```

## Submission material

- [DoraHacks submission guide](docs/SUBMISSION_GUIDE.md)
- [DreamDEX Perps submission pack](docs/PERPS_SUBMISSION.md)
- [90-second judge demo script](docs/DEMO_SCRIPT.md)
- [Revenue model](docs/EVENTRA_REVENUE_MODEL.md)
- [Contract documentation](contracts/README.md)

## Safety boundary

- Eventra provides decision support, not guaranteed returns.
- AI never submits an autonomous order.
- The user reviews and signs wallet actions.
- Test Arena orders are clearly labelled simulations and never appear as on-chain receipts.
- Analysis fees and DreamDEX trading collateral are separate.
