"use client";

import Link from "next/link";
import { ConnectButton } from "@rainbow-me/rainbowkit";

export function Header() {
  return (
    <header className="sticky top-0 z-20 border-b border-white/10 bg-[#0d0b17]/90 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
        <nav className="flex items-center gap-6">
          <Link href="/" className="text-lg font-extrabold tracking-tight text-white">
            Proof<span className="text-[#a58cff]">-of-</span>Play
          </Link>
          <Link href="/" className="hidden text-sm text-white/70 hover:text-white sm:inline">
            Explore
          </Link>
          <Link href="/create" className="text-sm text-white/70 hover:text-white">
            Create
          </Link>
        </nav>
        <ConnectButton showBalance={false} chainStatus="icon" accountStatus="address" />
      </div>
    </header>
  );
}
