"use client";

import Link from "next/link";
import {
  useEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type TextareaHTMLAttributes,
} from "react";
import { cx, reveal } from "@/lib/ui";

/* ------------------------------------------------------------------ */
/* Primitives                                                         */
/* ------------------------------------------------------------------ */

type Delay = 0 | 1 | 2 | 3 | 4 | 5;

export function Reveal({
  children,
  delay = 0,
  className,
}: {
  children: ReactNode;
  delay?: Delay;
  className?: string;
}) {
  return <div className={cx(reveal(delay), className)}>{children}</div>;
}

export function PixelButton({
  variant = "solid",
  busy,
  className,
  children,
  disabled,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "solid" | "ghost";
  busy?: boolean;
}) {
  return (
    <button
      {...props}
      data-busy={busy ? "true" : undefined}
      disabled={disabled || busy}
      className={cx(variant === "ghost" ? "pixel-btn-ghost" : "pixel-btn", className)}
    >
      {busy && <span className="inline-block h-2 w-2 animate-pulse bg-white" aria-hidden />}
      {children}
    </button>
  );
}

export function PixelLink({
  href,
  variant = "solid",
  className,
  children,
}: {
  href: string;
  variant?: "solid" | "ghost";
  className?: string;
  children: ReactNode;
}) {
  return (
    <Link href={href} className={cx(variant === "ghost" ? "pixel-btn-ghost" : "pixel-btn", className)}>
      {children}
    </Link>
  );
}

export function PixelChip({
  active,
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }) {
  return (
    <button
      type="button"
      {...props}
      aria-pressed={!!active}
      className={cx("pixel-chip", active && "pixel-chip-active", className)}
    >
      {children}
    </button>
  );
}

export function PixelBadge({
  tone = "default",
  className,
  children,
}: {
  tone?: "default" | "mining" | "trading" | "live";
  className?: string;
  children: ReactNode;
}) {
  const toneClass =
    tone === "mining"
      ? "border-[color:var(--monad-orange)] bg-[color:var(--monad-orange)] text-black"
      : tone === "trading"
        ? "border-[color:var(--good)] bg-[color:var(--good)] text-black"
        : tone === "live"
          ? "border-[color:var(--good)] text-[color:var(--good)]"
          : "bg-black/55";

  return <span className={cx("pixel-chip pointer-events-none", toneClass, className)}>{children}</span>;
}

export function PixelPanel({
  strong,
  className,
  children,
}: {
  strong?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return <div className={cx(strong ? "pixel-panel-strong" : "pixel-panel", "p-4", className)}>{children}</div>;
}

export function PixelCard({
  href,
  delay = 0,
  className,
  children,
}: {
  href: string;
  delay?: Delay;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Link href={href} className={cx("pixel-card", reveal(delay), className)}>
      {children}
    </Link>
  );
}

export function PixelInput({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cx("pixel-input", className)} />;
}

export function PixelTextarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={cx("pixel-input", className)} />;
}

export function PixelLoader({ label = "Loading" }: { label?: string }) {
  return (
    <p className="pixel-loader" role="status" aria-live="polite">
      {label}
    </p>
  );
}

export function PixelSkeleton({ className }: { className?: string }) {
  return <div className={cx("pixel-skeleton", className)} aria-hidden />;
}

export function BlinkCursor() {
  return <span className="pixel-blink ml-1 inline-block h-[1em] w-[0.55em] bg-[color:var(--monad-cyan)] align-[-0.1em]" aria-hidden />;
}

/** Pop the value whenever it changes — arcade score feedback. */
export function PopValue({
  value,
  className,
}: {
  value: string | number;
  className?: string;
}) {
  const [bump, setBump] = useState(0);
  const prev = useRef(value);

  useEffect(() => {
    if (prev.current === value) return;
    prev.current = value;
    setBump((n) => n + 1);
  }, [value]);

  return (
    <span key={bump} className={cx(bump > 0 && "pixel-pop", "inline-block", className)}>
      {value}
    </span>
  );
}

export function StatBlock({
  label,
  value,
  hint,
  accent,
}: {
  label: string;
  value: string;
  hint?: string;
  accent?: boolean;
}) {
  return (
    <div className={cx("flex flex-col gap-1 p-3", accent ? "pixel-panel-strong" : "pixel-panel")}>
      <span className="pixel-label text-[color:var(--muted)]">{label}</span>
      <PopValue value={value} className="pixel-num text-white" />
      {hint && <span className="pixel-label text-[color:var(--muted)] opacity-70">{hint}</span>}
    </div>
  );
}

export function ProgressBar({ pct }: { pct: number }) {
  const clamped = Math.max(0, Math.min(100, pct));
  return (
    <div className="h-3 overflow-hidden border-2 border-[color:var(--border)] bg-black/40" role="progressbar" aria-valuenow={clamped} aria-valuemin={0} aria-valuemax={100}>
      <div
        className="h-full bg-[color:var(--monad-orange)] transition-[width] duration-300 ease-out"
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}
