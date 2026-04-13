"use client";

import { useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";

export default function Faucet() {
  const { publicKey } = useWallet();
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [message, setMessage] = useState("");

  if (!publicKey) return null;

  const handleFaucet = async () => {
    setStatus("loading");
    setMessage("Minting test USDC...");

    try {
      const resp = await fetch("/vaults/api/faucet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wallet: publicKey.toBase58() }),
      });

      const data = await resp.json();

      if (!resp.ok) {
        setStatus("error");
        setMessage(data.error || "Faucet failed");
        return;
      }

      setStatus("success");
      setMessage(`Received ${data.amount} test USDC`);

      // Auto-reset after 10s
      setTimeout(() => { setStatus("idle"); setMessage(""); }, 10000);
    } catch (err: any) {
      setStatus("error");
      setMessage(err?.message || "Network error");
    }
  };

  return (
    <div className="panel p-4 flex items-center justify-between">
      <div>
        <div className="text-xs font-mono uppercase tracking-wider text-[var(--text-dim)] mb-1">Devnet Faucet</div>
        <div className="text-sm text-[var(--text-muted)]">
          {status === "idle" && "Get 100 test USDC to try depositing into vaults"}
          {status === "loading" && message}
          {status === "success" && (
            <span className="text-[var(--green)]">{message}</span>
          )}
          {status === "error" && (
            <span className="text-[var(--red)]">{message}</span>
          )}
        </div>
      </div>
      <button
        onClick={handleFaucet}
        disabled={status === "loading" || status === "success"}
        className="px-4 py-2 bg-[var(--primary)] hover:bg-[var(--primary-hover)] disabled:bg-[var(--bg-card)] disabled:text-[var(--text-dim)] rounded-lg text-sm font-medium transition whitespace-nowrap"
      >
        {status === "loading" ? "Minting..." : status === "success" ? "Done" : "Get Test USDC"}
      </button>
    </div>
  );
}
