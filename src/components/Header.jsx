import { Link, NavLink } from 'react-router-dom';
import { Sparkles } from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import { useSubscriptionGate } from '../context/SubscriptionContext.jsx';
import { LogoMark, Wordmark } from './Icons.jsx';
import { Avatar } from './ui.jsx';

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
              <span className="badge-premium">PREMIUM</span>
            ) : (
              <button type="button" className="subscribe-pill" onClick={() => requireSubscription()}>
                <Sparkles size={14} strokeWidth={2.4} aria-hidden="true" />Subscribe
              </button>
            )}
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
