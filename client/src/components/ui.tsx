import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

/* ───────────────────────────────────────────────────────────────────────────
   Primitives for the instrument panel.

   Three rules govern everything below:
     · ink at 55% at rest, full ink or periwinkle when live — never a fill
     · hairlines, never shadows; there is one light source and it is behind you
     · structure is uppercase mono with wide tracking; prose is the exception
   ─────────────────────────────────────────────────────────────────────────── */

export function TextButton({
  className,
  active,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }) {
  return (
    <button
      type="button"
      {...props}
      className={cn(
        "relative cursor-pointer font-mono text-meta uppercase transition-colors duration-200",
        "disabled:cursor-not-allowed disabled:opacity-35",
        active ? "text-ink" : "text-meta hover:text-indigo",
        className,
      )}
    >
      {props.children}
      {active ? <span className="bg-indigo absolute -bottom-1.5 left-0 h-px w-full" aria-hidden /> : null}
    </button>
  );
}

export function IconButton({
  className,
  circle,
  label,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { circle?: boolean; label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      data-tip={label}
      {...props}
      className={cn(
        "tooltip text-meta hover:text-indigo inline-flex cursor-pointer items-center justify-center transition-colors duration-200",
        "disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:text-meta",
        circle ? "border-wash hover:border-indigo size-8 rounded-full border" : "size-4",
        className,
      )}
    >
      {children}
    </button>
  );
}

/** Pill tag. The one component that fills, and only when you touch it. */
export function Chip({
  className,
  as = "span",
  ...props
}: { className?: string; as?: "span" | "button"; children: ReactNode } & Record<string, unknown>) {
  const Tag = as as "span";
  return (
    <Tag
      {...props}
      className={cn(
        "border-wash text-label inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1",
        "font-mono text-meta uppercase transition-colors duration-200",
        "hover:border-indigo hover:bg-indigo hover:text-paper",
        as === "button" && "cursor-pointer",
        className,
      )}
    />
  );
}

/** A surface that has risen off the ground. Fill and hairline, never a shadow. */
export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className={cn("border-wash rounded-card border bg-[rgba(244,243,255,0.035)] p-5", className)}>{children}</div>
  );
}

export function Section({
  title,
  aside,
  children,
  className,
}: {
  title: string;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("flex flex-col gap-4", className)}>
      <header className="flex items-center justify-between gap-3">
        <h2 className="text-meta font-mono text-meta uppercase">{title}</h2>
        {aside}
      </header>
      <div className="border-hairline-faint border-t" />
      <div className="flex flex-col gap-4">{children}</div>
    </section>
  );
}

export function Field({
  label,
  hint,
  children,
  className,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={cn("flex flex-col gap-2", className)}>
      <span className="text-meta font-mono text-meta uppercase">{label}</span>
      {children}
      {hint ? <span className="text-meta font-mono text-meta normal-case tracking-normal opacity-80">{hint}</span> : null}
    </label>
  );
}

const control =
  "border-wash text-ink w-full rounded-xs border bg-[rgba(244,243,255,0.04)] px-2.5 py-2 font-mono text-label " +
  "tracking-normal transition-colors duration-200 placeholder:text-meta hover:border-[rgba(244,243,255,0.28)] " +
  "focus:border-indigo focus:bg-[rgba(244,243,255,0.06)] focus:outline-none " +
  "disabled:cursor-not-allowed disabled:opacity-40";

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cn(control, className)} />;
}

export function NumberInput({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input type="number" {...props} className={cn(control, "tabular-nums", className)} />;
}

export function Select({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select {...props} className={cn(control, "cursor-pointer", className)}>
      {children}
    </select>
  );
}

export function ColorInput({ value, onChange, className }: { value: string; onChange: (v: string) => void; className?: string }) {
  return (
    <span
      className={cn(
        "border-wash focus-within:border-indigo flex items-center gap-2.5 rounded-xs border bg-[rgba(244,243,255,0.04)] px-2 py-1.5 transition-colors hover:border-[rgba(244,243,255,0.28)]",
        className,
      )}
    >
      <input type="color" value={normaliseHex(value)} onChange={(e) => onChange(e.target.value)} className="size-5 shrink-0" aria-label="colour" />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        spellCheck={false}
        className="text-ink min-w-0 flex-1 bg-transparent font-mono text-label tracking-[0.06em] uppercase outline-none"
        aria-label="colour value"
      />
    </span>
  );
}

function normaliseHex(value: string): string {
  const v = value.trim();
  if (/^#[0-9a-f]{6}$/i.test(v)) return v;
  if (/^#[0-9a-f]{3}$/i.test(v)) return `#${v[1]}${v[1]}${v[2]}${v[2]}${v[3]}${v[3]}`;
  return "#000000";
}

export function Slider({
  value,
  onChange,
  onCommitStart,
  min,
  max,
  step = 1,
  className,
}: {
  value: number;
  onChange: (v: number) => void;
  /** Fires once as the drag begins — the hook for taking an undo snapshot. */
  onCommitStart?: () => void;
  min: number;
  max: number;
  step?: number;
  className?: string;
}) {
  return (
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      onPointerDown={onCommitStart}
      onKeyDown={(e) => {
        if (e.key.startsWith("Arrow")) onCommitStart?.();
      }}
      onChange={(e) => onChange(Number(e.target.value))}
      className={cn("w-full", className)}
    />
  );
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  className,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
  className?: string;
}) {
  return (
    <div className={cn("flex items-center gap-4", className)} role="group">
      {options.map((o) => (
        <TextButton key={o.value} active={o.value === value} onClick={() => onChange(o.value)} aria-pressed={o.value === value}>
          {o.label}
        </TextButton>
      ))}
    </div>
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="group flex cursor-pointer items-center gap-2.5 font-mono text-meta uppercase"
    >
      <span
        className={cn(
          "flex size-3.5 items-center justify-center rounded-hairline border transition-colors duration-200",
          checked ? "border-indigo bg-indigo" : "border-hairline group-hover:border-indigo",
        )}
      >
        {checked ? (
          <svg viewBox="0 0 10 10" className="text-paper size-2.5" aria-hidden>
            <path d="M1.5 5.2 4 7.5 8.5 2.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        ) : null}
      </span>
      <span className={cn("transition-colors duration-200", checked ? "text-ink" : "text-meta group-hover:text-indigo")}>{label}</span>
    </button>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="text-meta font-mono text-meta uppercase">{children}</p>;
}

export function Stat({ label, value, accent }: { label: string; value: ReactNode; accent?: boolean }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-meta font-mono text-meta uppercase">{label}</span>
      <span className={cn("font-mono text-body tabular-nums", accent ? "text-indigo" : "text-ink")}>{value}</span>
    </div>
  );
}
