"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ConnectButton } from "@rainbow-me/rainbowkit";

const NAV = [
  { href: "/", label: "Explore" },
  { href: "/create", label: "Create" },
] as const;

export function Header() {
  const path = usePathname();

  return (
    <header className="sticky top-0 z-20 border-b-2 border-[color:var(--border)] bg-[color:var(--monad-ink)]/92 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
        <nav className="flex items-center gap-5 sm:gap-7">
          <Link
            href="/"
            className="pixel-title group text-[10px] text-white transition-colors sm:text-[11px] hover:text-[color:var(--monad-lilac)]"
            aria-label="Proof-of-Play home"
          >
            PoP
            <span className="ml-2 hidden text-[color:var(--muted)] sm:inline">Proof-of-Play</span>
          </Link>
          {NAV.map((item) => {
            const active = item.href === "/" ? path === "/" : path.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                data-active={active ? "true" : undefined}
                className={`pixel-label pixel-nav ${item.href === "/" ? "hidden sm:inline" : ""} ${
                  active ? "text-white" : "text-[color:var(--muted)]"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
        <ConnectButton showBalance={false} chainStatus="icon" accountStatus="address" />
      </div>
    </header>
  );
}
