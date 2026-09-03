"use client";

import { useCallback, useEffect, useState } from "react";
import { keccak256, toHex, type Address, type Hex, type WalletClient } from "viem";
import type { AdviceResponse } from "@/lib/advice";
import { SOMNIA_CHAIN_ID, somniaShannonTestnet } from "@/lib/chain/somnia";
import {
  DREAM_PILOT_GUARD_ADDRESS,
  FORECAST_REGISTRY_ADDRESS,
  dreamPilotGuardAbi,
  forecastRegistryAbi,
  forecastTypes,
} from "@/lib/guard/contracts";

type TxState = { phase: "idle" | "signing" | "confirming" | "success" | "error"; label?: string; hash?: Hex; error?: string };
type ContractStatus = { contractsLive: boolean; owner?: Address; authorizedSigner?: boolean; policyActive?: boolean; marketEnabled?: boolean; receiptStatus?: "success" | "reverted" | "pending" };

function shortAddress(value: string) {
  return `${value.slice(0, 8)}…${value.slice(-6)}`;
}

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message.split("\n")[0];
  return "Wallet request failed.";
}

export function DreamPilotProof({
  account,
  walletClient,
  marketId,
  minutesRemaining,
  model,
  forecast,
}: {
  account: Address | null;
  walletClient: WalletClient | null;
  marketId?: string;
  minutesRemaining: number;
  model: string;
  forecast?: AdviceResponse["forecast"];
}) {
  const [contractsLive, setContractsLive] = useState(false);
  const [owner, setOwner] = useState<Address | null>(null);
  const [authorizedSigner, setAuthorizedSigner] = useState(false);
  const [policyActive, setPolicyActive] = useState(false);
  const [marketEnabled, setMarketEnabled] = useState(false);
  const [tx, setTx] = useState<TxState>({ phase: "idle" });

  const refresh = useCallback(async () => {
    try {
      const query = new URLSearchParams();
      if (account) query.set("account", account);
      if (marketId) query.set("marketId", marketId);
      const response = await fetch(`/api/dreampilot/status?${query.toString()}`, { cache: "no-store" });
      if (!response.ok) throw new Error("Contract status request failed.");
      const status = await response.json() as ContractStatus;
      setContractsLive(status.contractsLive);
      setOwner(status.owner ?? null);
      setAuthorizedSigner(Boolean(status.authorizedSigner));
      setPolicyActive(Boolean(status.policyActive));
      setMarketEnabled(Boolean(status.marketEnabled));
    } catch {
      setContractsLive(false);
    }
  }, [account, marketId]);

  useEffect(() => { void refresh(); }, [refresh]);

  async function waitForReceipt(hash: Hex) {
    for (let attempt = 0; attempt < 45; attempt += 1) {
      const response = await fetch(`/api/dreampilot/status?txHash=${hash}`, { cache: "no-store" });
      if (response.ok) {
        const status = await response.json() as ContractStatus;
        if (status.receiptStatus === "success") return;
        if (status.receiptStatus === "reverted") throw new Error("Somnia transaction reverted.");
      }
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
    throw new Error("Transaction confirmation timed out. Check Somnia Explorer.");
  }

  async function activateGuard() {
    if (!account || !walletClient || !marketId) return;
    try {
      setTx({ phase: "signing", label: "Approve safety policy (1/2)" });
      const policyHash = await walletClient.writeContract({
        account,
        chain: somniaShannonTestnet,
        address: DREAM_PILOT_GUARD_ADDRESS,
        abi: dreamPilotGuardAbi,
        functionName: "setPolicy",
        args: [{
          maxStakeRaw: 10_000_000n,
          dailyStakeLimitRaw: 25_000_000n,
          minConfidenceBps: 6_000,
          maxAdviceAgeSec: 900,
          allowBuyYes: true,
          allowBuyNo: true,
          enabled: true,
        }],
      });
      setTx({ phase: "confirming", label: "Confirming policy", hash: policyHash });
      await waitForReceipt(policyHash);
      setTx({ phase: "signing", label: "Allow selected DreamDEX market (2/2)" });
      const marketHash = await walletClient.writeContract({
        account,
        chain: somniaShannonTestnet,
        address: DREAM_PILOT_GUARD_ADDRESS,
        abi: dreamPilotGuardAbi,
        functionName: "setMarketAllowed",
        args: [marketId as Hex, true],
      });
      setTx({ phase: "confirming", label: "Confirming market permission", hash: marketHash });
      await waitForReceipt(marketHash);
      setTx({ phase: "success", label: "Safety policy is live", hash: marketHash });
      await refresh();
    } catch (error) {
      setTx({ phase: "error", error: errorMessage(error) });
    }
  }

  async function commitForecast() {
    if (!account || !walletClient || !marketId || !forecast || !authorizedSigner) return;
    try {
      const issuedAt = BigInt(Math.floor(Date.now() / 1000));
      const validUntil = issuedAt + BigInt(Math.max(60, Math.round(minutesRemaining * 60)));
      const probabilityYesBps = Math.round((forecast.direction === "UP" ? forecast.confidence : 100 - forecast.confidence) * 100);
      const message = {
        marketId: marketId as Hex,
        snapshotHash: keccak256(toHex(JSON.stringify({ marketId, currentPrice: forecast.currentPrice, predictedPrice: forecast.predictedPrice, generatedAt: forecast.generatedAt }))),
        modelHash: keccak256(toHex(`${model}:${forecast.source}`)),
        probabilityYesBps,
        issuedAt,
        validUntil,
        nonce: BigInt(Date.now()),
      };
      setTx({ phase: "signing", label: "Sign forecast commitment (1/2)" });
      const signature = await walletClient.signTypedData({
        account,
        domain: { name: "DreamPilotForecastRegistry", version: "1", chainId: SOMNIA_CHAIN_ID, verifyingContract: FORECAST_REGISTRY_ADDRESS },
        types: forecastTypes,
        primaryType: "Forecast",
        message,
      });
      setTx({ phase: "signing", label: "Publish proof on Somnia (2/2)" });
      const hash = await walletClient.writeContract({
        account,
        chain: somniaShannonTestnet,
        address: FORECAST_REGISTRY_ADDRESS,
        abi: forecastRegistryAbi,
        functionName: "commitForecast",
        args: [message, signature],
      });
      setTx({ phase: "confirming", label: "Confirming forecast proof", hash });
      await waitForReceipt(hash);
      setTx({ phase: "success", label: "Forecast permanently recorded", hash });
    } catch (error) {
      setTx({ phase: "error", error: errorMessage(error) });
    }
  }

  const busy = tx.phase === "signing" || tx.phase === "confirming";
  return (
    <section className="onchain-cockpit" aria-label="DreamPilot on-chain controls">
      <header>
        <div><span>DreamPilot On-chain Proof</span><b>AI decisions you can verify, policies you control.</b></div>
        <em className={contractsLive ? "live" : "offline"}>{contractsLive ? "● LIVE · SOMNIA" : "● RPC UNAVAILABLE"}</em>
      </header>
      <div className="onchain-contracts">
        <a href={`${somniaShannonTestnet.blockExplorers.default.url}/address/${DREAM_PILOT_GUARD_ADDRESS}`} target="_blank" rel="noreferrer"><span>Safety contract</span><b>DreamPilotGuard</b><small>{shortAddress(DREAM_PILOT_GUARD_ADDRESS)}</small></a>
        <a href={`${somniaShannonTestnet.blockExplorers.default.url}/address/${FORECAST_REGISTRY_ADDRESS}`} target="_blank" rel="noreferrer"><span>Forecast contract</span><b>ForecastRegistry</b><small>{shortAddress(FORECAST_REGISTRY_ADDRESS)}</small></a>
        <div><span>Contract owner</span><b>{owner && account && owner.toLowerCase() === account.toLowerCase() ? "Your connected wallet" : owner ? shortAddress(owner) : "Checking…"}</b><small>Chain 50312</small></div>
      </div>
      <div className="onchain-actions">
        <div className={policyActive && marketEnabled ? "ready" : "pending"}>
          <span>01 · CONTROL</span><b>{policyActive && marketEnabled ? "Safety policy active" : "Activate your safety policy"}</b>
          <p>$10 max/order · $25/day · 60% confidence · selected market only.</p>
          <button type="button" disabled={busy || !walletClient || !marketId || (policyActive && marketEnabled)} onClick={() => void activateGuard()}>{policyActive && marketEnabled ? "✓ Policy on-chain" : walletClient ? "Activate with wallet" : "Connect wallet first"}</button>
        </div>
        <div className={tx.phase === "success" && tx.label?.includes("Forecast") ? "ready" : "pending"}>
          <span>02 · PROVE</span><b>Commit this AI forecast</b>
          <p>Locks market, model, snapshot and YES probability before settlement.</p>
          <button type="button" disabled={busy || !walletClient || !forecast || !authorizedSigner} onClick={() => void commitForecast()}>{!walletClient ? "Connect wallet first" : !authorizedSigner ? "Authorized demo signer required" : !forecast ? "Run AI forecast first" : "Record forecast on Somnia"}</button>
        </div>
      </div>
      {tx.phase !== "idle" ? <div className={`onchain-tx ${tx.phase}`}><span>{tx.phase === "error" ? "Action failed" : tx.label}</span>{tx.error ? <small>{tx.error}</small> : null}{tx.hash ? <a href={`${somniaShannonTestnet.blockExplorers.default.url}/tx/${tx.hash}`} target="_blank" rel="noreferrer">View transaction ↗</a> : null}</div> : null}
      <footer>Forecast proof does not execute a trade. DreamDEX execution still requires a separate wallet confirmation.</footer>
    </section>
  );
}
