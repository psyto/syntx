"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function CreatePage() {
  const router = useRouter();

  useEffect(() => {
    // Redirect to vault marketplace where the working Create Vault form lives
    router.replace("/vaults");
  }, [router]);

  return (
    <div className="max-w-[1100px] mx-auto px-6 py-10">
      <div className="panel p-12 text-center">
        <p className="text-[var(--text-muted)]">Redirecting to Vault Marketplace...</p>
        <p className="text-xs text-[var(--text-dim)] mt-2">
          Click <a href="/vaults" className="text-[var(--primary)] hover:underline">here</a> if not redirected.
        </p>
      </div>
    </div>
  );
}
