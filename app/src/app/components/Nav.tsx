"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import dynamic from "next/dynamic";

const WalletMultiButton = dynamic(
  () => import("@solana/wallet-adapter-react-ui").then((mod) => mod.WalletMultiButton),
  { ssr: false },
);

const NAV_LINKS = [
  { href: "https://fabrknt.com/flow", label: "Flow" },
  { href: "https://fabrknt.com/learn", label: "Learn" },
  { href: "/", label: "Syntx", active: true },
];

const TOOLBAR_LINKS = [
  { href: "/earn", label: "Earn" },
  { href: "/vaults", label: "Vaults" },
  { href: "/compose", label: "Compose" },
];

export default function Nav() {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-50">
      {/* Main nav — matches fabrknt.com header */}
      <div className="border-b border-[var(--border)] bg-[var(--bg)]/90 backdrop-blur-md">
        <div className="max-w-6xl mx-auto px-6 py-3 flex items-center justify-between">
          <a href="https://fabrknt.com" className="text-lg font-bold tracking-tight text-[var(--text)]">
            Fabrknt
          </a>
          <nav className="hidden md:flex items-center gap-6 text-sm">
            {NAV_LINKS.map((link) => (
              <a
                key={link.label}
                href={link.href}
                className={
                  link.active
                    ? "text-[var(--text)] font-medium"
                    : "text-[var(--text-muted)] hover:text-[var(--text)] transition-colors"
                }
              >
                {link.label}
              </a>
            ))}
          </nav>
        </div>
      </div>

      {/* Toolbar — Syntx-specific sub-nav */}
      <div className="border-b border-[var(--border)] bg-[var(--bg-panel)]">
        <div className="max-w-6xl mx-auto px-6 flex items-center justify-between">
          <div className="flex items-center gap-1">
            <span className="text-xs font-semibold text-[var(--primary)] mr-3">Syntx</span>
            <span className="text-[9px] font-mono uppercase tracking-wider text-[var(--orange)] border border-[var(--orange)]/30 rounded px-1.5 py-0.5 mr-4">Devnet</span>
            <nav className="hidden md:flex items-center gap-1">
              {TOOLBAR_LINKS.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  className={`px-3 py-2.5 text-sm transition-colors ${
                    pathname === link.href || (link.href === "/vaults" && pathname === "/")
                      ? "text-[var(--text)] border-b-2 border-[var(--primary)]"
                      : "text-[var(--text-muted)] hover:text-[var(--text)]"
                  }`}
                >
                  {link.label}
                </Link>
              ))}
            </nav>
          </div>
          <div className="py-1.5">
            <WalletMultiButton />
          </div>
        </div>
      </div>

      {/* Mobile toolbar */}
      <div className="flex md:hidden border-b border-[var(--border)] bg-[var(--bg-panel)]">
        {TOOLBAR_LINKS.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className={`flex-1 text-center py-2.5 text-xs transition-colors ${
              pathname === link.href || (link.href === "/vaults" && pathname === "/")
                ? "text-[var(--text)] border-b-2 border-[var(--primary)]"
                : "text-[var(--text-muted)]"
            }`}
          >
            {link.label}
          </Link>
        ))}
      </div>
    </header>
  );
}
