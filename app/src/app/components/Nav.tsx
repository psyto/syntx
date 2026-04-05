"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import dynamic from "next/dynamic";

const WalletMultiButton = dynamic(
  () => import("@solana/wallet-adapter-react-ui").then((mod) => mod.WalletMultiButton),
  { ssr: false },
);

const mainLinks = [
  { href: "https://fabrknt.com/flow", label: "Flow", external: true },
  { href: "https://fabrknt.com/learn", label: "Learn", external: true },
  { href: "/", label: "Vaults", external: false },
  { href: "https://fabrknt.com/dashboard", label: "Dashboard", external: true },
  { href: "https://github.com/fabrknt", label: "GitHub", external: true },
];

const toolbarLinks = [
  { href: "/vaults", label: "Vaults" },
  { href: "/compose", label: "Compose" },
  { href: "/earn", label: "Earn" },
  { href: "/create", label: "Create" },
];

export default function Nav() {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-50">
      {/* Main nav */}
      <div className="border-b border-[var(--border)] bg-[var(--bg)]/80 backdrop-blur-md">
        <div className="max-w-[1100px] mx-auto px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-2">
              <a href="https://fabrknt.com" className="text-lg font-bold tracking-tight text-[var(--text)]">Fabrknt</a>
              <span className="text-[9px] font-mono uppercase tracking-wider text-[var(--orange)] border border-[var(--orange)]/30 rounded px-1.5 py-0.5">Devnet</span>
            </div>
            <nav className="hidden md:flex items-center gap-1">
              {mainLinks.map((l) =>
                l.external ? (
                  <a
                    key={l.href}
                    href={l.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-3 py-1.5 rounded-lg text-sm text-[var(--text-muted)] hover:text-white transition"
                  >
                    {l.label}
                  </a>
                ) : (
                  <Link
                    key={l.href}
                    href={l.href}
                    className="px-3 py-1.5 rounded-lg text-sm text-white bg-[var(--bg-card)] transition"
                  >
                    {l.label}
                  </Link>
                ),
              )}
            </nav>
          </div>
        </div>
      </div>
      {/* Toolbar sub-nav */}
      <div className="border-b border-[var(--border)] bg-[var(--bg-panel)]">
        <div className="max-w-[1100px] mx-auto px-6 flex items-center gap-6">
          <nav className="hidden md:flex items-center gap-1 flex-1">
            {toolbarLinks.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className={`px-3 py-2.5 text-sm transition ${
                  pathname === l.href
                    ? "text-white border-b-2 border-[var(--primary)]"
                    : "text-[var(--text-muted)] hover:text-white"
                }`}
              >
                {l.label}
              </Link>
            ))}
          </nav>
          <div className="ml-auto py-1.5">
            <WalletMultiButton />
          </div>
        </div>
      </div>
      {/* Mobile nav */}
      <div className="flex md:hidden border-b border-[var(--border)] bg-[var(--bg-panel)]">
        {toolbarLinks.map((l) => (
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
