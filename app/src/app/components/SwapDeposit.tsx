"use client";

import { useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import {
  PublicKey,
  Transaction,
  TransactionInstruction,
  VersionedTransaction,
  SYSVAR_CLOCK_PUBKEY,
} from "@solana/web3.js";
import {
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";

// Devnet config
const VAULT_PDA = new PublicKey("4pL2aQawAbc2XwjRE9ptrH4yxihn4BL2uVMavgZrtYUK");
const SYNTX_PROGRAM_ID = new PublicKey("53r6bg7JBFqf5Jfs7fe4kHDtwXwUgDWoLarYrsWcoF1V");
const PERCOLATOR_PROGRAM_ID = new PublicKey("Edq18N2pdT3Sz9EukbZe4YsQkvmxvmmkUL1KHpv96xJF");
const PERCOLATOR_SLAB = new PublicKey("J55KavPouZg8ZeWnTY77ZBL2DdQskzKpkFvuTtbUNzYC");
const PERCOLATOR_VAULT = new PublicKey("A6HXGe48sAH1fKf43dipr5uoDqjEeCfuZE3gLKnVCY43");
const COLLATERAL_MINT = new PublicKey("2uGTCDSfisKCTN2Yd8umXiWJzfRpWe8mhZM6WCK2vj8D");
const SHARE_MINT = new PublicKey("6KMkX75jzL4jEDo9TXAr9NvCWefLnnv5vWLTtHtcmJqS");
const VAULT_COLLATERAL = new PublicKey("FfoNKzF2c48CBu84EkavTgrbMMa5LhfVYFfqBYDt12wD");

const DISC_DEPOSIT = new Uint8Array([0xf2, 0x23, 0xc6, 0x89, 0x52, 0xe1, 0xf2, 0xb6]);

// Common tokens on devnet
const TOKENS = [
  { symbol: "SOL", mint: "So11111111111111111111111111111111111111112", decimals: 9 },
  { symbol: "USDC", mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", decimals: 6 },
  { symbol: "Vault Token", mint: COLLATERAL_MINT.toBase58(), decimals: 6, direct: true },
];

// Jupiter API (devnet doesn't have full support — this is mainnet-ready)
const JUP_API = "https://lite-api.jup.ag/v1";

export default function SwapDeposit({ onSuccess }: { onSuccess: () => void }) {
  const { connection } = useConnection();
  const { publicKey, sendTransaction, signTransaction } = useWallet();
  const [selectedToken, setSelectedToken] = useState(TOKENS[2]); // default to vault token
  const [amount, setAmount] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [quoteInfo, setQuoteInfo] = useState<string | null>(null);

  if (!publicKey) return null;

  const handleSwapDeposit = async () => {
    if (!amount || !publicKey || !signTransaction) return;
    setStatus("Building..."); setError(null); setQuoteInfo(null);

    try {
      const rawAmount = BigInt(Math.floor(parseFloat(amount) * (10 ** selectedToken.decimals)));

      if (selectedToken.direct) {
        // Direct deposit — no swap needed
        await directDeposit(rawAmount);
      } else {
        // Swap via Jupiter first, then deposit
        await swapAndDeposit(rawAmount);
      }
    } catch (e: any) {
      console.error("SwapDeposit error:", e);
      setError(e?.message?.slice(0, 200) || "Failed");
      setStatus(null);
    }
  };

  const directDeposit = async (amount: bigint) => {
    if (!publicKey) return;

    const userCol = await getAssociatedTokenAddress(COLLATERAL_MINT, publicKey);
    const userShr = await getAssociatedTokenAddress(SHARE_MINT, publicKey);

    const tx = new Transaction();
    try { await connection.getTokenAccountBalance(userShr); } catch {
      tx.add(createAssociatedTokenAccountInstruction(publicKey, userShr, publicKey, SHARE_MINT));
    }

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
        { pubkey: VAULT_COLLATERAL, isSigner: false, isWritable: true },
        { pubkey: SHARE_MINT, isSigner: false, isWritable: true },
        { pubkey: PERCOLATOR_SLAB, isSigner: false, isWritable: true },
        { pubkey: PERCOLATOR_VAULT, isSigner: false, isWritable: true },
        { pubkey: PERCOLATOR_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: SYSVAR_CLOCK_PUBKEY, isSigner: false, isWritable: false },
      ],
      data: data as any,
    }));

    setStatus("Confirm in wallet...");
    const sig = await sendTransaction(tx, connection);
    setStatus("Confirming...");
    await connection.confirmTransaction(sig, "confirmed");
    setStatus(null); setAmount(""); onSuccess();
  };

  const swapAndDeposit = async (inputAmount: bigint) => {
    if (!publicKey || !signTransaction) return;

    // Step 1: Get Jupiter quote
    setStatus("Getting swap quote...");
    const quoteUrl = `${JUP_API}/quote?inputMint=${selectedToken.mint}&outputMint=${COLLATERAL_MINT.toBase58()}&amount=${inputAmount.toString()}&slippageBps=100`;

    const quoteResp = await fetch(quoteUrl);
    if (!quoteResp.ok) {
      throw new Error("Jupiter quote unavailable on devnet. Use 'Vault Token' for direct deposit.");
    }
    const quote = await quoteResp.json();
    const outAmount = quote.outAmount;
    setQuoteInfo(`Swap: ${amount} ${selectedToken.symbol} → ${(Number(outAmount) / 1e6).toFixed(2)} vault tokens`);

    // Step 2: Get swap transaction
    setStatus("Building swap TX...");
    const swapResp = await fetch(`${JUP_API}/swap`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        quoteResponse: quote,
        userPublicKey: publicKey.toBase58(),
        wrapAndUnwrapSol: true,
      }),
    });

    if (!swapResp.ok) throw new Error("Jupiter swap API failed");
    const { swapTransaction } = await swapResp.json();

    // Step 3: Sign and send swap
    setStatus("Confirm swap in wallet...");
    const swapTx = VersionedTransaction.deserialize(Buffer.from(swapTransaction, "base64"));
    const signedSwap = await signTransaction(swapTx);
    const swapSig = await connection.sendRawTransaction(signedSwap.serialize());
    await connection.confirmTransaction(swapSig, "confirmed");

    // Step 4: Deposit the swapped tokens
    setStatus("Depositing to vault...");
    await directDeposit(BigInt(outAmount));
  };

  return (
    <div className="panel p-6">
      <h3 className="text-xs font-mono uppercase tracking-wider text-[var(--text-dim)] mb-4">
        Swap & Deposit
      </h3>

      {(status || error) && (
        <div className={`mb-3 rounded-lg px-3 py-2 text-xs font-mono ${error ? "bg-red-950 text-[var(--red)]" : "bg-blue-950 text-[var(--primary)]"}`}>
          {error || status}
        </div>
      )}

      {quoteInfo && (
        <div className="mb-3 rounded-lg px-3 py-2 text-xs font-mono bg-green-950 text-[var(--green)]">
          {quoteInfo}
        </div>
      )}

      <div className="space-y-3">
        {/* Token selector */}
        <div className="flex gap-1">
          {TOKENS.map((t) => (
            <button
              key={t.symbol}
              onClick={() => setSelectedToken(t)}
              className={`px-3 py-1.5 rounded-lg text-xs font-mono transition ${
                selectedToken.symbol === t.symbol
                  ? "bg-[var(--primary)] text-white"
                  : "bg-[var(--bg-card)] text-[var(--text-muted)] hover:text-white"
              }`}
            >
              {t.symbol}
            </button>
          ))}
        </div>

        {/* Amount + button */}
        <div className="flex gap-2">
          <input
            type="number"
            placeholder={`Amount in ${selectedToken.symbol}`}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="flex-1 bg-[var(--bg)] border border-[var(--border)] rounded-lg px-3 py-2.5 text-sm font-mono focus:outline-none focus:border-[var(--primary)]"
          />
          <button
            onClick={handleSwapDeposit}
            disabled={!amount}
            className="px-5 py-2.5 bg-[var(--primary)] hover:bg-[var(--primary-hover)] disabled:bg-[var(--bg-card)] disabled:text-[var(--text-dim)] rounded-lg text-sm font-medium transition"
          >
            {selectedToken.direct ? "Deposit" : "Swap & Deposit"}
          </button>
        </div>

        <p className="text-[10px] text-[var(--text-dim)]">
          {selectedToken.direct
            ? "Direct deposit — no swap needed"
            : `Swaps ${selectedToken.symbol} → vault token via Jupiter, then deposits`}
        </p>
      </div>
    </div>
  );
}
