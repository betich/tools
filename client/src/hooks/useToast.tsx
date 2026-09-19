import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

type Toast = { id: number; message: string };

const ToastContext = createContext<(message: string) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const push = useCallback((message: string) => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { id, message }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 2400);
  }, []);

  const value = useMemo(() => push, [push]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed right-6 bottom-20 md:bottom-28 z-70 flex flex-col items-end gap-2" aria-live="polite">
        {toasts.map((t) => (
          <div
            key={t.id}
            style={{ boxShadow: "0 24px 60px -20px rgba(0,0,0,0.8)" }}
            className="animate-toast-in border-wash bg-panel-high text-ink rounded-card border px-4 py-2.5 font-mono text-meta uppercase"
          >
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);
