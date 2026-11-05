import { useEffect, useState } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import { MessageCircle, RefreshCw, Users } from 'lucide-react';
import { supabase } from '../lib/supabase.js';
import { useAuth } from '../context/AuthContext.jsx';
import { GafferIcon, LogoMark, Wordmark } from '../components/Icons.jsx';
import { Spinner } from '../components/ui.jsx';

const FEATURES = [
  { icon: <RefreshCw size={18} strokeWidth={2} aria-hidden="true" />, t: 'Synced for everyone', d: 'One host, one moment. A goal never gets spoiled in the chat.' },
  { icon: <GafferIcon size={18} />, t: 'Ask Gaffer anything', d: 'Your AI match expert explains offsides, handballs, cards and tactics from real match data.' },
  { icon: <MessageCircle size={18} strokeWidth={2} aria-hidden="true" />, t: 'Chat, react, predict', d: 'Emoji reactions over the video and AI prediction polls with a party leaderboard.' },
];

function friendlyError(error, mode) {
  const msg = error?.message ?? '';
  if (/already registered|already been registered|exists/i.test(msg)) return 'That email already has an account — sign in instead.';
  if (/invalid login credentials/i.test(msg)) return 'Wrong email or password.';
  if (/email not confirmed/i.test(msg)) return 'Email confirmation is switched on in Supabase — turn it off (Auth → Providers → Email).';
  if (/password/i.test(msg) && mode === 'signup') return 'Use a password of at least 6 characters.';
  if (/rate limit/i.test(msg)) return 'Too many attempts — wait a minute and try again.';
  return msg || 'Something went wrong — try again.';
}

export default function Login() {
  const { user, loading } = useAuth();
  const [params] = useSearchParams();
  const next = params.get('next') || '/';
  const fromInvite = next.startsWith('/invite/');
  const [mode, setMode] = useState(fromInvite ? 'signup' : 'signin');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => setError(''), [mode]);

  if (!loading && user) return <Navigate to={next} replace />;

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    const addr = email.trim();
    if (mode === 'signup' && !name.trim()) { setError('Pick a display name your friends will see.'); return; }
    if (password.length < 6) { setError('Use a password of at least 6 characters.'); return; }
    setBusy(true);
    const { data, error: authError } = mode === 'signup'
      ? await supabase.auth.signUp({ email: addr, password, options: { data: { display_name: name.trim() } } })
      : await supabase.auth.signInWithPassword({ email: addr, password });
    setBusy(false);
    if (authError) { setError(friendlyError(authError, mode)); return; }
    // Supabase returns a user with no identities when the email is already taken.
    if (mode === 'signup' && data?.user && data.user.identities?.length === 0) {
      setError('That email already has an account — sign in instead.');
      return;
    }
    if (mode === 'signup' && !data?.session) {
      setError('Account created, but email confirmation is on in Supabase — turn it off so people can sign in straight away.');
    }
  };

  return (
    <div className="page">
      <header className="site-header">
        <div className="container inner">
          <span className="logo"><LogoMark /><Wordmark /></span>
        </div>
      </header>
      <main className="login-main">
        <section className="login-hero">
          <h1 className="h-cond">Watch together, wherever you are.</h1>
          <p>Live and classic football with your friends, a shared chat and Gaffer, an AI that explains what just happened on the pitch.</p>
          <ul className="feature-list">
            {FEATURES.map((f) => (
              <li key={f.t}>
                <span className="ic">{f.icon}</span>
                <div><div className="t">{f.t}</div><div className="d">{f.d}</div></div>
              </li>
            ))}
          </ul>
        </section>

        <section className="auth-card" aria-label="Sign in or create an account">
          {fromInvite && (
            <div className="banner-accent"><Users size={14} strokeWidth={2.2} style={{ verticalAlign: '-2px', marginRight: 6 }} aria-hidden="true" />Create an account to join the watch party.</div>
          )}
          <div className="auth-tabs" role="tablist">
            <button type="button" role="tab" aria-selected={mode === 'signin'} onClick={() => setMode('signin')}>Sign in</button>
            <button type="button" role="tab" aria-selected={mode === 'signup'} onClick={() => setMode('signup')}>Create account</button>
          </div>
          <form className="auth-form" onSubmit={submit} noValidate>
            {mode === 'signup' && (
              <div className="field">
                <label htmlFor="lg-name" className="label">Display name</label>
                <input id="lg-name" className="input" autoComplete="nickname" maxLength={40} value={name} onChange={(e) => setName(e.target.value)} placeholder="What friends will see" />
              </div>
            )}
            <div className="field">
              <label htmlFor="lg-email" className="label">Email</label>
              <input id="lg-email" type="email" className="input" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
            </div>
            <div className="field">
              <label htmlFor="lg-pass" className="label">Password</label>
              <input id="lg-pass" type="password" className="input" autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} required value={password} onChange={(e) => setPassword(e.target.value)} placeholder={mode === 'signup' ? 'At least 6 characters' : ''} />
            </div>
            {error && <span role="alert" className="form-error">{error}</span>}
            <button type="submit" className="btn btn-primary btn-lg" disabled={busy}>
              {busy && <Spinner />}{mode === 'signup' ? 'Create account' : 'Sign in'}
            </button>
            <span style={{ fontSize: 12, color: 'var(--muted-3)', lineHeight: 1.5 }}>
              {mode === 'signup' ? 'Any email works — no confirmation email is sent. New accounts start without a subscription.' : 'New here? Create an account with any email.'}
            </span>
          </form>
        </section>
      </main>
    </div>
  );
}
