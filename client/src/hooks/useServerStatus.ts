import { useEffect, useState } from "react";
import { api } from "@/lib/api";

export type ServerStatus = "checking" | "online" | "offline";

/**
 * Both tools run fully in the browser, so the server going away degrades
 * features (save, share, batch render) rather than breaking the app. The UI
 * needs to know which state it is in to say so honestly.
 */
export function useServerStatus(): ServerStatus {
  const [status, setStatus] = useState<ServerStatus>("checking");

  useEffect(() => {
    let alive = true;
    const timer = setTimeout(() => alive && setStatus((s) => (s === "checking" ? "offline" : s)), 4000);
    api
      .health()
      .then(() => alive && setStatus("online"))
      .catch(() => alive && setStatus("offline"))
      .finally(() => clearTimeout(timer));
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, []);

  return status;
}
