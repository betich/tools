import { createContext, useContext, type ButtonHTMLAttributes, type ComponentProps, type InputHTMLAttributes, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { normaliseHex } from "@/lib/color";

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

type ButtonLook = {
  variant?: "primary" | "outline" | "ghost";
  /** `sm` is a section's own action, set in its header: 28px, the same voice at half the weight. */
  size?: "md" | "sm";
};

/** The button's classes, for the one place a link must look like one — a download served by another origin. */
export function buttonClass({ variant = "primary", size = "md" }: ButtonLook = {}, className?: string) {
  return cn(
    "inline-flex cursor-pointer items-center justify-center rounded-xs font-mono text-meta whitespace-nowrap uppercase",
    size === "sm" ? "h-7 gap-1.5 px-2.5" : "h-9 gap-2 px-4",
    "transition-colors duration-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo",
    "disabled:cursor-not-allowed disabled:opacity-35",
    variant === "primary" && "bg-ink text-paper font-bold hover:bg-indigo disabled:hover:bg-ink",
    variant === "outline" &&
      "border-edge text-ink border hover:border-indigo hover:text-indigo disabled:hover:border-edge disabled:hover:text-ink",
    variant === "ghost" && size === "md" && "px-3",
    variant === "ghost" && "text-label hover:bg-hover-wash hover:text-indigo disabled:hover:bg-transparent disabled:hover:text-label",
    className,
  );
}

/**
 * A real button, for the one action a surface exists to perform — export, copy
 * the link, download. `primary` is the only solid-ink shape in the chrome, so
 * it can be found without reading; it arrives at periwinkle like everything
 * else. `outline` is its quieter sibling for the second-best action, and
 * `ghost` is a button only by its height and its hover wash — for an action
 * that belongs in the row but should not compete with the other two.
 */
export function Button({ className, variant, size, ...props }: ComponentProps<"button"> & ButtonLook) {
  return <button type="button" {...props} className={buttonClass({ variant, size }, className)} />;
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
    <div className={cn("border-wash rounded-card border bg-surface p-5", className)}>{children}</div>
  );
}

const Stacked = createContext(false);

/**
 * A column of sections with a full-width rule *between* them, the way an
 * inspector reads: the rule ends one section, the heading opens the next. Inside
 * it a section drops the rule under its own title, so there is only ever one
 * line between two groups of controls.
 */
export function Sections({ className, children, ...props }: ComponentProps<"div">) {
  return (
    <Stacked.Provider value>
      <div
        {...props}
        className={cn(
          "flex flex-col gap-7 [&>*+*]:border-t [&>*+*]:border-hairline-faint [&>*+*]:pt-7",
          className,
        )}
      >
        {children}
      </div>
    </Stacked.Provider>
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
  const stacked = useContext(Stacked);
  return (
    <section className={cn("flex flex-col gap-4", className)}>
      <header className="flex min-h-5 items-center justify-between gap-3">
        <h2 className="text-meta font-mono text-meta uppercase">{title}</h2>
        {aside}
      </header>
      {stacked ? null : <div className="border-hairline-faint border-t" />}
      <div className="flex flex-col gap-4">{children}</div>
    </section>
  );
}

export function Field({
  label,
  hint,
  children,
  className,
  changed,
  action,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
  className?: string;
  /** The value differs from where it came from — the label arrives at periwinkle. */
  changed?: boolean;
  /** A small control at the end of the label line, such as a put-back glyph. */
  action?: ReactNode;
}) {
  return (
    <label className={cn("flex flex-col gap-2", className)}>
      <span className="flex min-h-4 items-center justify-between gap-2">
        <span className={cn("font-mono text-meta uppercase transition-colors duration-200", changed ? "text-indigo" : "text-meta")}>
          {label}
        </span>
        {action}
      </span>
      {children}
      {hint ? <span className="text-meta font-mono text-meta normal-case tracking-normal opacity-80">{hint}</span> : null}
    </label>
  );
}

const control =
  "border-wash text-ink w-full rounded-xs border bg-control px-2.5 py-2 font-mono text-label " +
  "tracking-normal transition-colors duration-200 placeholder:text-meta hover:border-edge " +
  "focus:border-indigo focus:bg-surface-high focus:outline-none " +
  "disabled:cursor-not-allowed disabled:opacity-40";

export function Input({ className, ...props }: ComponentProps<"input">) {
  return <input {...props} className={cn(control, className)} />;
}

export function NumberInput({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input type="number" {...props} className={cn(control, "tabular-nums", className)} />;
}

export function Select({ className, children, ...props }: ComponentProps<"select">) {
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
        "border-wash focus-within:border-indigo flex items-center gap-2.5 rounded-xs border bg-control px-2 py-1.5 transition-colors hover:border-edge",
        className,
      )}
    >
      <input type="color" value={normaliseHex(value, { short: true }) ?? "#000000"} onChange={(e) => onChange(e.target.value)} className="size-5 shrink-0" aria-label="colour" />
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

export function Slider({
  value,
  onChange,
  onCommitStart,
  min,
  max,
  step = 1,
  disabled,
  className,
}: {
  value: number;
  onChange: (v: number) => void;
  /** Fires once as the drag begins — the hook for taking an undo snapshot. */
  onCommitStart?: () => void;
  min: number;
  max: number;
  step?: number;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      disabled={disabled}
      value={value}
      onPointerDown={onCommitStart}
      onKeyDown={(e) => {
        if (e.key.startsWith("Arrow")) onCommitStart?.();
      }}
      onChange={(e) => onChange(Number(e.target.value))}
      className={cn("w-full disabled:cursor-not-allowed disabled:opacity-35", className)}
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

/**
 * A segmented control whose options are glyphs, in the same bordered strip as
 * the align-to-page cluster: 28px cells, the chosen one at 7% fill and full
 * ink, each named by its tooltip. The end cells anchor their tip to the strip's
 * edge so it is never clipped by a scrolling pane.
 */
export function IconSegmented<T extends string>({
  value,
  onChange,
  options,
  label,
  className,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string; icon: ReactNode }[];
  label: string;
  className?: string;
}) {
  return (
    <div role="group" aria-label={label} className={cn(segStrip, className)}>
      {options.map((o, i) => (
        <button
          key={o.value}
          type="button"
          aria-label={o.label}
          aria-pressed={o.value === value}
          data-tip={o.label}
          data-tip-pos={i === 0 ? "top-left" : i === options.length - 1 ? "top-right" : undefined}
          onClick={() => onChange(o.value)}
          className={segCell(o.value === value)}
        >
          {o.icon}
        </button>
      ))}
    </div>
  );
}

export const segStrip = "border-wash flex w-fit items-center gap-0.5 rounded-xs border bg-control p-0.5";

export function segCell(on: boolean) {
  return cn(
    "tooltip flex size-7 cursor-pointer items-center justify-center rounded-xs transition-colors duration-200",
    "focus-visible:outline-1 focus-visible:outline-indigo",
    on ? "text-ink bg-surface-high" : "text-meta hover:text-indigo hover:bg-hover-wash",
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

/** A sentence in the panel: Inter, sentence case, the meta size. */
export function Prose({ children }: { children: ReactNode }) {
  return <p className="text-meta text-body font-sans normal-case leading-snug">{children}</p>;
}

/** A number inside uppercase chrome: normal tracking, tabular figures; `accent` for the one that matters. */
export function Value({ children, accent }: { children: ReactNode; accent?: boolean }) {
  return <span className={cn("tabular-nums tracking-normal", accent ? "text-indigo" : "text-ink")}>{children}</span>;
}
