// Lightweight toasts with optional Undo. Undo is preferred over confirmation for reversible actions.

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";

interface Toast {
  id: number;
  text: string;
  error?: boolean;
  undo?: () => void | Promise<void>;
}

interface ToastApi {
  show(text: string, opts?: { undo?: () => void | Promise<void>; error?: boolean }): void;
}

const Ctx = createContext<ToastApi>({ show: () => undefined });

export function useToast(): ToastApi {
  return useContext(Ctx);
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);

  const api = useMemo<ToastApi>(
    () => ({
      show(text, opts) {
        const id = nextId.current++;
        setToasts((t) => [...t.slice(-2), { id, text, ...opts }]);
        setTimeout(() => dismiss(id), opts?.undo ? 7000 : 3500);
      },
    }),
    [dismiss],
  );

  return (
    <Ctx.Provider value={api}>
      {children}
      <div className="toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.error ? "error" : ""}`} role={t.error ? "alert" : "status"}>
            <span className="truncate" style={{ flex: 1 }}>
              {t.text}
            </span>
            {t.undo && (
              <button
                className="btn"
                onClick={() => {
                  dismiss(t.id);
                  void t.undo?.();
                }}
              >
                Undo
              </button>
            )}
            <button className="btn" aria-label="Dismiss" onClick={() => dismiss(t.id)}>
              ×
            </button>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}
