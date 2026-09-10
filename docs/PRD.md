# DreamPilot V0.3 — Guided Live Testnet MVP

## Problem

Prediction-market users can ask AI for a trade opinion, but most demos hide whether the campaign data is real, which model answered, and where human control begins. DreamPilot binds each recommendation to a specific DreamDEX Event Contract snapshot and keeps wallet signing outside the AI boundary.

## Goals

- Read active BTC/ETH Event Contracts from DreamDEX on Somnia Shannon testnet.
- Let users choose a zero-cost model route using one free OpenRouter API key.
- Produce one schema-validated recommendation: `BUY_UP`, `BUY_DOWN`, or `WAIT`.
- Show thesis, counter-thesis, risks, missing data, invalidation, and a capped stake suggestion.
- Preserve model, latency, token usage, timestamp, market ID, venue ID and input snapshot.

## Non-goals

- Autonomous trading or server-held private keys.
- Profit guarantees or financial advice.
- Treating manual spot/volatility inputs as DreamDEX data.
- Mainnet execution.
- Sending a testnet transaction before wallet connection and explicit human confirmation are implemented.

## P0 acceptance criteria

- The app lists only non-expired markets from `@somnia-chain/markets-sdk` 0.28.0 across the configured and standard fallback DreamDEX venues.
- Market probability, volume, trade count and expiry are derived from the selected SDK row.
- Missing market price is labelled and forces the advisor to `WAIT`.
- User can choose one of five currently verified OpenRouter free routes.
- Missing `OPENROUTER_API_KEY` blocks AI generation with a setup message; no Simulation result is generated.
- API validates every request and AI response.
- `WAIT` creates no order draft.
- Review Order never sends a transaction in this checkpoint.

## UX flow

DreamPilot uses a linear three-step flow instead of presenting market input,
model choice, and AI output at the same time:

1. **Discover campaign:** rank all open DreamDEX contracts by usable market
   evidence (price availability, trade count, volume, and time remaining).
   Explain why each campaign is worth analyzing or why it lacks enough data.
   The product must say "not enough data to enter" when no open campaign has a
   real price and trades; it must not manufacture a best bet.
2. **Choose AI:** compare the available free model routes and confirm that the
   server-side API key is ready.
3. **Review advice:** read the recommendation, confidence, both sides of the
   thesis, invalidation condition, risks, and the human-controlled next step.

Each step has one primary action. The final step remains inaccessible until an
analysis exists, and the analysis action remains disabled when the API key or a
live market snapshot is missing.

Discovery rankings indicate data quality, not expected profit. The recommended
card must always show direction, expiry, trades, volume, and a plain-language
reason before the user continues.

## Success metrics

- Live market route success rate and latency.
- AI structured-output success rate by selected free model.
- Share of recommendations with a traceable market ID.
- Rate of `WAIT` when price or liquidity evidence is missing.

## Fast follow

- Read live best bid/ask and depth from the selected Event Contract order book.
- Connect a browser wallet on chain `50312`.
- Build a transaction preview and gate every write on on-chain `Trading` status.
- Require explicit user signing; never keep a private key in the browser or server env.
- Add claim/redeem flow for settled winning positions.
