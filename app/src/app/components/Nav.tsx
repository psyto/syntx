"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import dynamic from "next/dynamic";

const WalletMultiButton = dynamic(
  () => import("@solana/wallet-adapter-react-ui").then((mod) => mod.WalletMultiButton),
  { ssr: false },
);

const links = [
  { href: "/", label: "Home" },
  { href: "/vaults", label: "Vaults" },
  { href: "/compose", label: "Compose" },
  { href: "/earn", label: "Earn" },
  { href: "/create", label: "Create" },
];

export default function Nav() {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-50 border-b bg-[var(--bg)]/80 backdrop-blur-md">
      <div className="max-w-[1100px] mx-auto px-6 h-14 flex items-center justify-between">
        <div className="flex items-center gap-6">
          <Link href="/" className="flex items-center gap-2">
            <span className="text-lg font-bold tracking-tight">syntx</span>
            <span className="text-[9px] font-mono px-1.5 py-0.5 rounded border text-[var(--text-dim)]">
              DEVNET
            </span>
          </Link>
          <nav className="hidden md:flex items-center gap-1">
            {links.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className={`px-3 py-1.5 rounded-lg text-sm transition ${
                  pathname === l.href
                    ? "text-white bg-[var(--bg-card)]"
                    : "text-[var(--text-muted)] hover:text-white"
                }`}
              >
                {l.label}
              </Link>
            ))}
          </nav>
        </div>
        <div className="flex items-center gap-3">
          <a
            href="https://github.com/psyto/syntx"
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-[var(--text-dim)] hover:text-white transition hidden md:block"
          >
            GitHub
          </a>
          <WalletMultiButton />
        </div>
      </div>
      {/* Mobile nav */}
      <div className="flex md:hidden border-t border-[var(--border)]">
        {links.map((l) => (
          <Link
            key={l.href}
            href={l.href}
            className={`flex-1 text-center py-2.5 text-xs transition ${
              pathname === l.href
                ? "text-white border-b-2 border-[var(--primary)]"
                : "text-[var(--text-muted)]"
            }`}
          >
            {l.label}
          </Link>
        ))}
      </div>
    </header>
  );
}
