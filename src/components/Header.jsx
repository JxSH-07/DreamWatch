import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { Bell, Sparkles } from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import { useInvites } from '../context/InvitesContext.jsx';
import { useSubscriptionGate } from '../context/SubscriptionContext.jsx';
import { LogoMark, Wordmark } from './Icons.jsx';
import { Avatar, LiveBadge } from './ui.jsx';

function InvitesBell() {
  const { invites } = useInvites();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    const esc = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  return (
    <div className="bell" ref={ref}>
      <button
        type="button"
        className="icon-btn"
        aria-label={invites.length ? `${invites.length} watch party ${invites.length === 1 ? 'invite' : 'invites'}` : 'Invites'}
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((o) => !o)}
      >
        <Bell size={18} strokeWidth={2} aria-hidden="true" />
        {invites.length > 0 && <span className="bell-badge tab-num">{invites.length}</span>}
      </button>
      {open && (
        <div className="bell-menu rise-in" role="menu" aria-label="Watch party invites">
          <span className="bell-title">Invites</span>
          {invites.length === 0 ? (
            <p className="bell-empty">No invites right now. When a friend invites you to a watch party, it shows up here.</p>
          ) : invites.map((inv) => (
            <div key={inv.party_id} className="bell-item" role="menuitem">
              <Avatar name={inv.party.host?.display_name} ring={inv.party.host?.avatar_color} size={36} />
              <div className="bell-text">
                <span className="t">{inv.party.host?.display_name ?? 'A friend'} invited you</span>
                <span className="d">{inv.party.name} · {inv.party.match?.title}</span>
                {inv.party.status === 'live' && <span style={{ marginTop: 2 }}><LiveBadge small /></span>}
              </div>
              <button type="button" className="btn btn-primary btn-xs" onClick={() => { setOpen(false); navigate(`/invite/${inv.party_id}`); }}>
                Join
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function Header({ nav = true }) {
  const { profile, user, isSubscribed, signOut } = useAuth();
  const requireSubscription = useSubscriptionGate();

  return (
    <header className="site-header">
      <div className="container inner">
        <Link to="/" className="logo" aria-label="Dream Watch home">
          <LogoMark />
          <Wordmark />
        </Link>
        {nav && (
          <nav className="site-nav" aria-label="Primary">
            <NavLink to="/" end>Home</NavLink>
            <a href="/#live">Live</a>
            <a href="/#classics">Matches</a>
          </nav>
        )}
        {user && (
          <div className="header-right">
            {isSubscribed ? (
              <span className="badge-premium hide-xs">PREMIUM</span>
            ) : (
              <button type="button" className="subscribe-pill" onClick={() => requireSubscription()}>
                <Sparkles size={14} strokeWidth={2.4} aria-hidden="true" />Subscribe
              </button>
            )}
            <InvitesBell />
            <span aria-label={`Signed in as ${profile?.display_name ?? user.email}`} title={user.email}>
              <Avatar name={profile?.display_name ?? user.email} ring={profile?.avatar_color} size={40} />
            </span>
            <button type="button" className="text-btn hide-xs" onClick={signOut}>Sign out</button>
          </div>
        )}
      </div>
    </header>
  );
}
