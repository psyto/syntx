"use client";

import Link from "next/link";

export default function Footer() {
  return (
    <footer className="border-t mt-auto">
      <div className="max-w-6xl mx-auto px-6 py-6">
        <div className="flex flex-wrap items-center justify-between gap-4 text-xs text-[var(--text-muted)]">
          <div className="flex items-center gap-4">
            <a href="https://fabrknt.com/flow" className="hover:text-white transition">Flow</a>
            <a href="https://fabrknt.com/learn" className="hover:text-white transition">Learn</a>
            <Link href="/" className="hover:text-white transition">Syntx</Link>
            <a href="https://fabrknt.com/about" className="hover:text-white transition">About</a>
            <a href="https://github.com/fabrknt" target="_blank" rel="noopener noreferrer" className="hover:text-white transition">GitHub</a>
            <a href="https://x.com/fabrknt" target="_blank" rel="noopener noreferrer" className="hover:text-white transition">X</a>
          </div>
          <div className="flex items-center gap-4">
            <a href="https://github.com/aeyakovenko/percolator" target="_blank" rel="noopener noreferrer" className="hover:text-white transition">Percolator</a>
            <a href="https://solana.com" target="_blank" rel="noopener noreferrer" className="hover:text-white transition">Solana</a>
            <a href="https://pyth.network" target="_blank" rel="noopener noreferrer" className="hover:text-white transition">Pyth</a>
          </div>
        </div>
        <div className="mt-4 pt-4 border-t border-[var(--border)] flex items-center justify-between text-[10px] text-[var(--text-dim)]">
          <span>Syntx — Composable Perp Vaults on Solana</span>
          <span>Powered by Percolator — <a href="https://fabrknt.com" target="_blank" rel="noopener noreferrer" className="hover:text-white transition">fabrknt.com</a></span>
        </div>
      </div>
    </footer>
  );
}
