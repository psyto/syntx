"use client";

import { useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import {
  PublicKey,
  Transaction,
  TransactionInstruction,
  SYSVAR_CLOCK_PUBKEY,
} from "@solana/web3.js";
import {
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";

// Current devnet vault (post-timelock program)
const VAULT_PDA = new PublicKey("H2Hvrz4sS4bcBFdD4s1GQ2dWWctfYh35uR2Qqi1H1reH");
const SYNTX_PROGRAM_ID = new PublicKey("53r6bg7JBFqf5Jfs7fe4kHDtwXwUgDWoLarYrsWcoF1V");
const PERCOLATOR_PROGRAM_ID = new PublicKey("Edq18N2pdT3Sz9EukbZe4YsQkvmxvmmkUL1KHpv96xJF");
const PERCOLATOR_SLAB = new PublicKey("9Gh75RYAkN5wD97HtHo6Za6RwPReZSAcgNxtbvYy2jDF");
const COLLATERAL_MINT = new PublicKey("AhGQVQm7HudP6eWekMDLZiZogwvnMPFGL5owZCHFGquC");
const SHARE_MINT = new PublicKey("GSxRz5DG451b4dVJbSwj5zbKCeT4xodLwYTZmVx3v5st");

const DISC_DEPOSIT = new Uint8Array([0xf2, 0x23, 0xc6, 0x89, 0x52, 0xe1, 0xf2, 0xb6]);

type Step = "idle" | "faucet" | "deposit" | "done" | "error";

export default function SwapDeposit({ onSuccess }: { onSuccess: () => void }) {
  const { connection } = useConnection();
  const { publicKey, sendTransaction } = useWallet();
  const [step, setStep] = useState<Step>("idle");
  const [message, setMessage] = useState("");
  const [txSig, setTxSig] = useState("");

  if (!publicKey) {
    return (
      <div className="text-xs text-[var(--text-dim)] p-4">
        Connect wallet to try
      </div>
    );
  }

  const handleOneClick = async () => {
    if (!publicKey) return;

    try {
      // Step 1: Faucet — get test USDC + SOL
      setStep("faucet");
      setMessage("Getting test USDC from faucet...");

      const faucetResp = await fetch("/vaults/api/faucet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wallet: publicKey.toBase58() }),
      });

      const faucetData = await faucetResp.json();
      if (!faucetResp.ok) {
        // Rate limited is OK — user probably already has tokens
        if (faucetResp.status !== 429) {
          throw new Error(faucetData.error || "Faucet failed");
        }
        setMessage("Already have test USDC — depositing...");
      } else {
        setMessage(`Got ${faucetData.amount} test USDC — now depositing...`);
      }

      // Step 2: Deposit 10 USDC into vault
      setStep("deposit");
      const amount = BigInt(10_000_000); // 10 USDC

      const userCol = await getAssociatedTokenAddress(COLLATERAL_MINT, publicKey);
      const userShr = await getAssociatedTokenAddress(SHARE_MINT, publicKey);
      const vaultCol = await getAssociatedTokenAddress(COLLATERAL_MINT, VAULT_PDA, true);

      const [percVaultPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("vault"), PERCOLATOR_SLAB.toBuffer()],
        PERCOLATOR_PROGRAM_ID,
      );
      const percVaultAta = await getAssociatedTokenAddress(COLLATERAL_MINT, percVaultPda, true);

      const tx = new Transaction();

      // Create share ATA if needed
      try {
        await connection.getTokenAccountBalance(userShr);
      } catch {
        tx.add(createAssociatedTokenAccountInstruction(publicKey, userShr, publicKey, SHARE_MINT));
      }

      // Deposit instruction
      const data = new Uint8Array(16);
      data.set(DISC_DEPOSIT, 0);
      new DataView(data.buffer).setBigUint64(8, amount, true);

      tx.add(new TransactionInstruction({
        programId: SYNTX_PROGRAM_ID,
        keys: [
          { pubkey: publicKey, isSigner: true, isWritable: true },
          { pubkey: VAULT_PDA, isSigner: false, isWritable: true },
          { pubkey: userCol, isSigner: false, isWritable: true },
          { pubkey: userShr, isSigner: false, isWritable: true },
          { pubkey: vaultCol, isSigner: false, isWritable: true },
          { pubkey: SHARE_MINT, isSigner: false, isWritable: true },
          { pubkey: PERCOLATOR_SLAB, isSigner: false, isWritable: true },
          { pubkey: percVaultAta, isSigner: false, isWritable: true },
          { pubkey: PERCOLATOR_PROGRAM_ID, isSigner: false, isWritable: false },
          { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
          { pubkey: SYSVAR_CLOCK_PUBKEY, isSigner: false, isWritable: false },
        ],
        data: data as any,
      }));

      setMessage("Confirm in wallet...");
      const sig = await sendTransaction(tx, connection);
      setMessage("Confirming...");
      await connection.confirmTransaction(sig, "confirmed");

      setTxSig(sig);
      setStep("done");
      setMessage("Deposited 10 USDC into SOL Funding Rate vault!");
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
          onClick={handleOneClick}
          className="h-10 px-6 bg-[var(--primary)] hover:bg-[var(--primary-hover)] rounded-lg text-sm font-medium transition"
        >
          One-Click: Get USDC + Deposit into Vault
        </button>
      )}

      {(step === "faucet" || step === "deposit") && (
        <div className="flex items-center gap-3">
          <div className="w-4 h-4 border-2 border-[var(--primary)] border-t-transparent rounded-full animate-spin" />
          <span className="text-sm text-[var(--text-muted)]">{message}</span>
        </div>
      )}

      {step === "done" && (
        <div className="space-y-2">
          <div className="text-sm text-[var(--green)]">{message}</div>
          {txSig && (
            <a
              href={`https://explorer.solana.com/tx/${txSig}?cluster=devnet`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-[var(--primary)] hover:underline"
            >
              View transaction on Solana Explorer →
            </a>
          )}
          <button
            onClick={() => { setStep("idle"); setMessage(""); setTxSig(""); }}
            className="text-xs text-[var(--text-dim)] hover:text-white"
          >
            Try again
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
