import { createContext, useCallback, useContext, useRef, useState } from 'react';
import { Check, X } from 'lucide-react';
import { supabase } from '../lib/supabase.js';
import { useAuth } from './AuthContext.jsx';
import { useToast } from './ToastContext.jsx';
import { LogoMark } from '../components/Icons.jsx';
import { Spinner } from '../components/ui.jsx';

const SubscriptionContext = createContext(null);

const BENEFITS = ['Watch live and classic matches', 'Host watch parties with friends', 'Ask Gaffer, your AI match expert'];

export function SubscriptionProvider({ children }) {
  const { isSubscribed, refreshProfile } = useAuth();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const pending = useRef(null);

  const requireSubscription = useCallback((action) => {
    if (isSubscribed) {
      action?.();
      return;
    }
    pending.current = action ?? null;
    setOpen(true);
  }, [isSubscribed]);

  const close = () => {
    pending.current = null;
    setOpen(false);
  };

  const subscribe = async () => {
    setBusy(true);
    const { error } = await supabase.rpc('mock_subscribe');
    if (error) {
      setBusy(false);
      toast("Couldn't subscribe — try again", 'warn');
      return;
    }
    await refreshProfile();
    setBusy(false);
    setOpen(false);
    toast("You're subscribed 🎉");
    const action = pending.current;
    pending.current = null;
    action?.();
  };

  return (
    <SubscriptionContext.Provider value={requireSubscription}>
      {children}
      {open && (
        <div className="overlay" onClick={close}>
          <div className="dialog sm rise-in" role="dialog" aria-modal="true" aria-labelledby="sub-title" onClick={(e) => e.stopPropagation()}>
            <div className="dialog-head">
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 12 }}>
                <LogoMark size={40} ring="#0D1220" />
                <h2 id="sub-title" className="dialog-title" style={{ fontSize: 28 }}>Subscribe to Dream Watch?</h2>
              </div>
              <button type="button" className="icon-btn" aria-label="Close" onClick={close}><X size={16} strokeWidth={2.4} /></button>
            </div>
            <div className="dialog-body">
              <ul className="check-list">
                {BENEFITS.map((b) => (
                  <li key={b}><Check size={16} strokeWidth={3} aria-hidden="true" />{b}</li>
                ))}
              </ul>
              <p style={{ margin: 0, fontSize: 12, color: 'var(--muted-3)' }}>Demo: no payment is taken.</p>
            </div>
            <div className="dialog-foot">
              <button type="button" className="btn btn-ghost" onClick={close} disabled={busy}>Cancel</button>
              <button type="button" className="btn btn-primary" onClick={subscribe} disabled={busy} autoFocus>
                {busy && <Spinner />}Yes, subscribe
              </button>
            </div>
          </div>
        </div>
      )}
    </SubscriptionContext.Provider>
  );
}

export const useSubscriptionGate = () => useContext(SubscriptionContext);
