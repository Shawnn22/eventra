# Eventra AI + Assisted Execution Pricing

## Pricing unit

Eventra uses two independent charges:

1. **AI analysis fee** — a fixed price for each completed model response.
2. **Execution fee** — a percentage charged only when a DreamDEX order is filled.

Never bundle these into one opaque fee. A user may analyze without trading, and a
failed AI request must cost zero.

## AI price per completed analysis

The estimates below assume one Eventra analysis consumes at most **4,000 input
tokens + 800 output tokens**. Provider cost includes OpenRouter's current 5.5%
credit-purchase fee but excludes cache discounts, so the estimate is conservative.

| Product option | OpenRouter model / service | Estimated provider cost | User price | Eventra Credits |
|---|---|---:|---:|---:|
| Eventra Core | Local deterministic engine | ~$0.000 | **Free** | 0 |
| DeepSeek | `deepseek/deepseek-chat` | ~$0.0028 | **$0.02** | 2 |
| ChatGPT | `openai/gpt-5-mini` | ~$0.0028 | **$0.03** | 3 |
| Claude | `anthropic/claude-haiku-4.5` | ~$0.0085 | **$0.04** | 4 |
| Grok | `x-ai/grok-4.20`, including one web-search call | ~$0.0127 | **$0.05** | 5 |
| Surf | AskSurf direct API, not OpenRouter | Not verified | **$0.05 provisional** | 5 |

`1 Eventra Credit = $0.01 USDC`. Surf must remain labelled **provisional** until
AskSurf publishes or supplies actual API billing. Do not imply that Surf is routed
through OpenRouter.

### Cost formula

```text
provider cost = ((input tokens × input rate) + (output tokens × output rate)) / 1,000,000
              + optional tool costs
provider cost with credits = provider cost × 1.055
```

Examples for the standard 4,000/800-token request:

- DeepSeek: `($0.40 × .004 + $1.30 × .0008) × 1.055 ≈ $0.0028`.
- GPT-5 Mini: `($0.25 × .004 + $2.00 × .0008) × 1.055 ≈ $0.0028`.
- Claude Haiku 4.5: `($1.00 × .004 + $5.00 × .0008) × 1.055 ≈ $0.0084`.
- Grok 4.20: `(($1.25 × .004 + $2.50 × .0008) + $0.005 search) × 1.055 ≈ $0.0127`.

Pricing must be configuration-driven because model rates can change. Refresh model
rates from OpenRouter before launch and at least daily after launch.

## Payment experience

Do **not** ask for a wallet signature for every AI request. That would make a
$0.02 analysis feel more expensive than the analysis itself.

- User tops up Eventra Credits once with USDC (recommended minimum: $5).
- UI displays the exact credit price on each model card before selection.
- Server reserves credits when analysis starts and captures them only after a
  valid structured response is returned.
- Timeout, provider error, invalid JSON, or canceled request releases the full
  reservation automatically.
- A retry caused by Eventra or OpenRouter is never billed as a second analysis.
- If the request exceeds 4,000 input or 800 output tokens, require a new price
  quote before running it; never silently overcharge.

For the hackathon/testnet demo, all paid models can use promotional credits while
still showing the future mainnet price as `Demo credit · Mainnet $0.0X`.

## Product decision

The execution fee is separate from AI billing. Eventra only charges it when an
assisted trade is successfully filled. Rejected wallet requests, reverted
transactions, canceled orders, and unfilled orders incur no execution fee.

## Recommended pricing

| Mode | Fee |
|---|---:|
| Somnia testnet | 0% |
| Eventra Core on mainnet | 0.25% of filled collateral |
| Any AI provider | AI price above + 0.25% of filled collateral |

Apply a $0.02 minimum and $2 maximum per completed order. Show the estimated fee before wallet confirmation and the final fee in the transaction receipt.

## Why this model

- Revenue scales with real user value rather than analysis clicks.
- No fee is charged when execution fails.
- Small orders remain affordable and the cap protects larger traders.
- Fixed model pricing covers inference transparently; execution pricing remains
  aligned with filled trading value.

## On-chain implementation options

### V1 — DreamDEX native builder fee

Use `builder` and `builderFeeBpsTimes1k` in `placeBinaryOrder`. This is the most DreamDEX-native path and attributes revenue on-chain. It requires the trader to approve the Eventra builder for each pool before a non-zero fee can be charged.

Do not enable this on testnet until the approval and fee cap are shown clearly in the UI.

### V2 — Eventra execution router

A narrowly scoped router can collect the disclosed fee and place the DreamDEX order in one call after a one-time TestUSDC approval. The router must:

- whitelist verified DreamDEX pools;
- enforce a hard maximum fee;
- never retain user collateral after the transaction;
- refund unused collateral atomically;
- expose fee and recipient in events;
- support pausing and independent audit.

V2 reduces repeated approvals but increases smart-contract risk. Build it only after the direct DreamDEX order path is stable.

## Acceptance criteria

- The order preview shows fee rate and estimated dollar fee.
- Testnet always displays and charges 0%.
- Mainnet fee is charged only against filled volume.
- Failed, rejected, reverted, canceled, and unfilled orders charge zero.
- The wallet transaction and Eventra receipt expose the fee recipient and amount.
- A fee configuration above the product hard cap is rejected client-side and on-chain.

## Metrics

- Successful order conversion rate.
- Filled volume and fee revenue.
- Revenue per AI inference.
- Gross margin per model and per completed analysis.
- AI completion/refund rate.
- Credit top-up conversion and remaining-credit breakage.
- First-order approval abandonment.
- Repeat-trade rate after the first approval.
