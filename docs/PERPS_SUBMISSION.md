# Eventra Perps — DreamDEX bounty submission pack

## One-line pitch

Eventra turns live DreamDEX Perps data into an explainable trade plan, checks risk and on-chain executability, then lets the user open and close positions from their own wallet.

## Problem

Perpetual trading interfaces expose price, leverage and an order button, but leave users to combine market structure, funding, activity, open interest, liquidation distance and wallet readiness on their own. This makes an already leveraged product harder to evaluate and easier to misuse.

## Solution

Eventra provides one compact workflow:

`Live market → AI decision brief → Risk simulation → On-chain preflight → Open → Monitor → Close`

The AI layer is decision support rather than an autonomous trader. It explains the directional thesis, confidence, evidence quality, counter-thesis and invalidation. The user still chooses direction, collateral and leverage and signs every transaction.

## Why DreamDEX is essential

DreamDEX supplies the Perps markets, mark price, OHLCV, funding, open interest, account positions, margin preview, order sizing and final execution. Eventra uses the official Markets SDK instead of recreating a synthetic exchange.

## Live integration

- Network: Hideki Testnet
- Chain ID: `50383`
- SDK: `@somnia-chain/markets-sdk` `0.32.1`
- Indexer: official Hideki v2 DreamDEX endpoint
- Collateral: USDso
- Gas token: STT
- Supported actions: connect wallet, add/switch network, read balances, approve collateral, deposit margin, open a Perps position, read portfolio, close 25%, 50% or 100%

## Safety and execution design

- Market data that cannot be verified is labelled demo data.
- Opening orders run an on-chain preflight before the wallet prompt.
- Closing refetches the latest indexed position instead of trusting stale UI state.
- Close quantity is capped to the current position and aligned to the market lot size.
- DreamDEX executable size is checked before signing.
- The exact close calldata is simulated with `eth_call` before the wallet opens.
- Eventra cannot sign autonomously and never holds the user's funds or private key.

## AI support

The report combines:

- Thirty-minute OHLCV direction and range.
- Funding-side pressure.
- Indexed trade activity and quote volume.
- Open interest.
- Evidence quality and confidence.
- Counter-thesis and price invalidation.
- Position sizing, liquidation distance and reward-to-risk.

The output is intentionally framed as conditional evidence, not guaranteed returns.

## Judge demo flow

1. Open `/perps` and show that the header reports DreamDEX live data.
2. Select BTC-PERP, ETH-PERP or SOL-PERP.
3. Explain the AI decision brief, counter-thesis and invalidation.
4. Adjust Long/Short, collateral and leverage.
5. Review liquidation price, max risk, AI target and reward-to-risk.
6. Connect the wallet; Eventra adds or switches to Hideki when needed.
7. Review the on-chain preflight.
8. Confirm allowance, margin deposit and order only when each step is required.
9. Scroll to Positions and show size, entry, mark and unrealized PnL.
10. Click Close, select 25%, 50% or Close all, then confirm the wallet transaction.

## Public links

- Product: `https://evantra-ai.vercel.app/perps`
- Source: `https://github.com/Shawnn22/eventra`

## Submission checklist

- [x] TypeScript passes.
- [x] Perps self-check passes against the Hideki indexer.
- [x] Production build passes.
- [x] Live wallet balance and position reads work.
- [x] Open-order preflight and signing pipeline are implemented.
- [x] Partial/full close with liquidity check and calldata simulation is implemented.
- [ ] Essential Perps source is committed and pushed to GitHub.
- [ ] `/perps` returns HTTP 200 on the public production URL.
- [ ] One wallet-confirmed close transaction is recorded for the demo.
- [ ] Desktop and mobile screenshots are added to the DoraHacks entry.
- [ ] Demo video uses the Perps flow above.
