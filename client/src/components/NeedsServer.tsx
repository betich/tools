import type { ReactNode } from "react";
import { useServerStatus } from "@/hooks/useServerStatus";
import { cn } from "@/lib/cn";
import { Empty } from "./ui";

/**
 * For a tool that does its work on the api. While the server answers, the
 * children render; while it does not, the space they would fill holds one
 * sentence saying so instead. Nothing is mounted that could call the api and
 * throw.
 */
export function NeedsServer({ what, children, className }: { what: string; children: ReactNode; className?: string }) {
  const status = useServerStatus();

  if (status === "online") return <>{children}</>;

  return (
    <div
      className={cn(
        "border-wash rounded-card flex min-h-64 flex-col items-start justify-center gap-3 border border-dashed px-6 py-10",
        className,
      )}
    >
      {status === "checking" ? (
        <Empty>checking api…</Empty>
      ) : (
        <>
          <Empty>api offline</Empty>
          <p className="text-prose text-body max-w-xl font-sans normal-case">
            {what} happens on the server, and the server is not answering right now. Try again in a little while.
          </p>
        </>
      )}
    </div>
  );
}
