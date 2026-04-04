"use client";

import Link from "next/link";

export default function Footer() {
  return (
    <footer className="border-t mt-auto">
      <div className="max-w-[1100px] mx-auto px-6 py-8">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-8 text-xs">
          <div>
            <div className="font-medium mb-3">Protocol</div>
            <div className="space-y-2 text-[var(--text-muted)]">
              <Link href="/vaults" className="block hover:text-white transition">Vaults</Link>
              <Link href="/earn" className="block hover:text-white transition">Earn</Link>
              <Link href="/create" className="block hover:text-white transition">Create Vault</Link>
            </div>
          </div>
          <div>
            <div className="font-medium mb-3">Built On</div>
            <div className="space-y-2 text-[var(--text-muted)]">
              <a href="https://github.com/aeyakovenko/percolator" target="_blank" className="block hover:text-white transition">Percolator</a>
              <a href="https://solana.com" target="_blank" className="block hover:text-white transition">Solana</a>
              <a href="https://pyth.network" target="_blank" className="block hover:text-white transition">Pyth Network</a>
            </div>
          </div>
          <div>
            <div className="font-medium mb-3">Composable With</div>
            <div className="space-y-2 text-[var(--text-muted)]">
              <span className="block">Jupiter</span>
              <span className="block">Kamino</span>
              <span className="block">Marginfi</span>
            </div>
          </div>
          <div>
            <div className="font-medium mb-3">Developers</div>
            <div className="space-y-2 text-[var(--text-muted)]">
              <a href="https://github.com/psyto/syntx" target="_blank" className="block hover:text-white transition">GitHub</a>
              <a href="https://github.com/psyto/syntx/blob/main/docs/HOW-IT-WORKS.md" target="_blank" className="block hover:text-white transition">Documentation</a>
              <a href="https://github.com/psyto/syntx/blob/main/sdk" target="_blank" className="block hover:text-white transition">SDK</a>
            </div>
          </div>
        </div>
        <div className="mt-8 pt-6 border-t border-[var(--border)] flex items-center justify-between text-[10px] text-[var(--text-dim)]">
          <span>Syntx Protocol — Composable Perp Vaults on Solana</span>
          <span>Powered by Percolator</span>
        </div>
      </div>
    </footer>
  );
}
