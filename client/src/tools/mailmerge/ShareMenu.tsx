import { useState } from "react";
import { Field, Input, TextButton } from "@/components/ui";

/** The gate a locked merge shows until its password is given. */
export function PasswordGate({
  error,
  onSubmit,
  onCancel,
}: {
  error: string | null;
  onSubmit: (password: string) => void;
  /** Offered when there is something to go back to. */
  onCancel?: () => void;
}) {
  const [password, setPassword] = useState("");

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(password);
      }}
      className="border-wash rounded-card mb-6 max-w-sm border bg-surface p-6"
    >
      <Field label="password" hint={error ?? "this merge is locked"}>
        <Input autoFocus type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="off" />
      </Field>
      <div className="mt-3 flex items-center justify-between gap-4">
        <TextButton type="submit">open</TextButton>
        {onCancel ? <TextButton onClick={onCancel}>cancel</TextButton> : null}
      </div>
    </form>
  );
}
