import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import { TextButton } from "./ui";

/**
 * How long the server keeps what was uploaded, said plainly, with the way to
 * end it sooner. Discard is destructive, so it takes two taps: the first arms
 * it (periwinkle, "discard?"), the second deletes; left alone it disarms after
 * 3.5 s. `onDiscard` is expected to call DELETE and reset the page — see
 * `useJob().discard`.
 */
export function RetentionNote({
  onDiscard,
  disabled,
  className,
}: {
  onDiscard: () => unknown;
  disabled?: boolean;
  className?: string;
}) {
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 3500);
    return () => clearTimeout(t);
  }, [armed]);

  const click = async () => {
    if (!armed) return setArmed(true);
    setArmed(false);
    setBusy(true);
    try {
      await onDiscard();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={cn("flex flex-wrap items-baseline gap-x-3 gap-y-1", className)}>
      <p className="text-meta text-body font-sans normal-case">
        Files are deleted an hour after your last action, or now:
      </p>
      <TextButton onClick={click} disabled={disabled || busy} className={cn(armed && "text-indigo")}>
        {busy ? "discarding…" : armed ? "discard?" : "discard"}
      </TextButton>
    </div>
  );
}
