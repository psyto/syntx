"use client";

import { useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import Link from "next/link";

type Step = "idle" | "faucet" | "done" | "error";

export default function SwapDeposit({ onSuccess }: { onSuccess: () => void }) {
  const { publicKey } = useWallet();
  const [step, setStep] = useState<Step>("idle");
  const [message, setMessage] = useState("");

  if (!publicKey) {
    return (
      <div className="text-xs text-[var(--text-dim)] p-4">
        Connect wallet to try
      </div>
    );
  }

  const handleFaucet = async () => {
    if (!publicKey) return;

    try {
      setStep("faucet");
      setMessage("Getting test USDC from faucet...");

      const faucetResp = await fetch("/vaults/api/faucet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wallet: publicKey.toBase58() }),
      });

      const faucetData = await faucetResp.json();
      if (!faucetResp.ok && faucetResp.status !== 429) {
        throw new Error(faucetData.error || "Faucet failed");
      }

      setStep("done");
      setMessage(faucetResp.status === 429
        ? "You already have test USDC!"
        : `Got ${faucetData.amount} test USDC + SOL for gas`);
      onSuccess();
    } catch (e: any) {
      setStep("error");
      setMessage(e?.message?.slice(0, 200) || "Failed");
    }
  };

  return (
    <div className="mt-4 space-y-3">
      {step === "idle" && (
        <button
          onClick={handleFaucet}
          className="h-10 px-6 bg-[var(--primary)] hover:bg-[var(--primary-hover)] rounded-lg text-sm font-medium transition"
        >
          Get Test USDC
        </button>
      )}

      {step === "faucet" && (
        <div className="flex items-center gap-3">
          <div className="w-4 h-4 border-2 border-[var(--primary)] border-t-transparent rounded-full animate-spin" />
          <span className="text-sm text-[var(--text-muted)]">{message}</span>
        </div>
      )}

      {step === "done" && (
        <div className="space-y-2">
          <div className="text-sm text-[var(--green)]">{message}</div>
          <Link
            href="/earn"
            className="inline-flex h-9 px-4 items-center bg-[var(--primary)] hover:bg-[var(--primary-hover)] rounded-lg text-sm font-medium transition"
          >
            Deposit on Earn page →
          </Link>
          <button
            onClick={() => { setStep("idle"); setMessage(""); }}
            className="block text-xs text-[var(--text-dim)] hover:text-white mt-1"
          >
            Get more USDC
          </button>
        </div>
      )}

      {step === "error" && (
        <div className="space-y-2">
          <div className="text-sm text-[var(--red)]">{message}</div>
          <button
            onClick={() => { setStep("idle"); setMessage(""); }}
            className="text-xs text-[var(--text-dim)] hover:text-white"
          >
            Try again
          </button>
        </div>
      )}
    </div>
  );
}
