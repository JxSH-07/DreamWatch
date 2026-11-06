import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { Check, Info } from 'lucide-react';

const ToastContext = createContext(() => {});

// toast(text, kind = 'ok' | 'warn', action?: { label, onClick })
export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const nextId = useRef(0);

  const dismiss = useCallback((id) => setToasts((t) => t.filter((x) => x.id !== id)), []);

  const toast = useCallback((text, kind = 'ok', action = null) => {
    const id = ++nextId.current;
    setToasts((t) => [...t.slice(-2), { id, text, kind, action }]);
    setTimeout(() => dismiss(id), action ? 9000 : 3200);
  }, [dismiss]);

  const value = useMemo(() => toast, [toast]);
  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toast-wrap" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast rise-in ${t.kind === 'warn' ? 'warn' : ''} ${t.action ? 'has-action' : ''}`}>
            {t.kind === 'warn' ? <Info size={14} strokeWidth={3} aria-hidden="true" /> : <Check size={14} strokeWidth={3} aria-hidden="true" />}
            <span>{t.text}</span>
            {t.action && (
              <button type="button" className="toast-action" onClick={() => { dismiss(t.id); t.action.onClick(); }}>
                {t.action.label}
              </button>
            )}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);
