import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import { AuthProvider } from './context/AuthContext.jsx';
import { ToastProvider } from './context/ToastContext.jsx';
import { SubscriptionProvider } from './context/SubscriptionContext.jsx';
import { isConfigured, supabase } from './lib/supabase.js';
import { syncServerClock } from './lib/serverClock.js';
import { setLiveEpoch } from './lib/matchTime.js';
import './styles/index.css';
import './styles/pages.css';
import './styles/room.css';

setLiveEpoch(import.meta.env.VITE_LIVE_EPOCH);

if (isConfigured) {
  syncServerClock(supabase);
  setInterval(() => syncServerClock(supabase), 60_000);
}

function MissingConfig() {
  return (
    <div className="page">
      <main className="center-screen">
        <div className="empty-state">
          <h1 className="h-cond" style={{ fontSize: 36 }}>Supabase isn't configured</h1>
          <p>Copy <code>.env.example</code> to <code>.env</code>, set <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code>, then restart the dev server.</p>
        </div>
      </main>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    {isConfigured ? (
      <BrowserRouter>
        <ToastProvider>
          <AuthProvider>
            <SubscriptionProvider>
              <App />
            </SubscriptionProvider>
          </AuthProvider>
        </ToastProvider>
      </BrowserRouter>
    ) : (
      <MissingConfig />
    )}
  </React.StrictMode>,
);
