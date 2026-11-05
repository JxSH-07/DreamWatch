import { useCallback, useEffect, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { ArrowRight, Check, Lock } from 'lucide-react';
import Header from '../components/Header.jsx';
import { Avatar, Loader, Spinner } from '../components/ui.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { useSubscriptionGate } from '../context/SubscriptionContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { useMatch } from '../hooks/useMatch.js';
import { supabase } from '../lib/supabase.js';
import { MatchStrip, TeamPicker } from './Lobby.jsx';

const BENEFITS = ['Live matches and full replays', 'Watch parties with friends', 'Gaffer AI explanations', 'Demo: no payment is taken'];

function Message({ title, body }) {
  return (
    <main className="center-screen">
      <div className="empty-state">
        <h1 className="h-cond" style={{ fontSize: 36 }}>{title}</h1>
        <p>{body}</p>
        <Link to="/" className="btn btn-primary">Back to Home</Link>
      </div>
    </main>
  );
}

export default function Invite() {
  const { partyId } = useParams();
  const { profile, isSubscribed } = useAuth();
  const requireSubscription = useSubscriptionGate();
  const toast = useToast();
  const navigate = useNavigate();
  const [preview, setPreview] = useState(undefined);
  const [team, setTeam] = useState(null);
  const [joining, setJoining] = useState(false);
  const { match, events } = useMatch(preview?.match_id);

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc('get_invite_preview', { p_party: partyId });
    setPreview(error ? null : data?.[0] ?? null);
  }, [partyId]);

  useEffect(() => { load(); }, [load, isSubscribed]);

  const join = useCallback(async (pickedTeam) => {
    setJoining(true);
    const { data, error } = await supabase.rpc('join_party', { p_party: partyId, p_team: pickedTeam ?? null });
    setJoining(false);
    if (error) {
      const msg = error.message;
      toast(/removed/.test(msg) ? 'The host removed you from this party.' : /ended/.test(msg) ? 'This party has ended.' : /subscription/.test(msg) ? 'You need a subscription to join.' : "Couldn't join — try again", 'warn');
      load();
      return;
    }
    navigate(data === 'live' ? `/party/${partyId}` : `/party/${partyId}/lobby`);
  }, [partyId, navigate, toast, load]);

  if (preview === undefined) return <div className="page"><Header nav={false} /><Loader /></div>;

  const wrap = (content) => <div className="page"><Header nav={false} />{content}</div>;

  if (!preview) return wrap(<Message title="Party not found" body="This invite link doesn't match a watch party. Ask your friend to send it again." />);
  if (preview.viewer_member_status === 'removed') return wrap(<Message title="You can't rejoin this party" body="The host removed you from this party." />);
  if (preview.party_status === 'ended') return wrap(<Message title="This party has ended" body={`${preview.host_name}'s watch party is over. Start your own from the home page.`} />);
  if (isSubscribed && preview.viewer_member_status === 'joined') {
    return <Navigate to={preview.party_status === 'live' ? `/party/${partyId}` : `/party/${partyId}/lobby`} replace />;
  }

  const first = profile?.display_name ? `Hi ${profile.display_name}, ` : '';
  return wrap(
    <main className="invite-main">
      <div className="invite-col">
        <div className="invite-head">
          <Avatar name={preview.host_name} ring={preview.host_color} size={52} />
          <h1 className="h-cond">{first}{preview.host_name} invited you to watch {preview.match_title} together</h1>
          <p>
            Join <strong style={{ color: 'var(--text)' }}>{preview.party_name}</strong> to watch in sync, chat as it happens and ask Gaffer,
            the AI match companion, about any decision.{preview.joined_count > 1 ? ` ${preview.joined_count} people are already in.` : ''}
          </p>
        </div>

        {match && <MatchStrip match={match} events={events} />}

        {!isSubscribed ? (
          <section aria-labelledby="iv-sub-h" className="card" style={{ padding: 22, borderColor: 'var(--line-3)', display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
              <span className="lock-ic"><Lock size={18} strokeWidth={2.2} aria-hidden="true" /></span>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <h2 id="iv-sub-h" style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>You'll need Dream Watch Premium to join</h2>
                <p style={{ margin: 0, fontSize: 14, lineHeight: 1.55, color: 'var(--muted)' }}>
                  Everyone streams the match on their own subscription, so we can keep the picture in sync for the whole party. Once you subscribe, we'll take you straight in.
                </p>
              </div>
            </div>
            <ul className="benefits">
              {BENEFITS.map((b) => <li key={b}><Check size={14} strokeWidth={3} aria-hidden="true" />{b}</li>)}
            </ul>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', borderTop: '1px solid var(--line)', paddingTop: 16, justifyContent: 'flex-end' }}>
              <Link to="/" className="btn btn-ghost btn-lg" style={{ color: 'var(--muted)' }}>Maybe later</Link>
              <button type="button" className="btn btn-primary btn-lg" disabled={joining} onClick={() => requireSubscription(() => join(team))}>
                {joining && <Spinner />}Subscribe &amp; join<ArrowRight size={16} strokeWidth={2.6} aria-hidden="true" />
              </button>
            </div>
          </section>
        ) : (
          <section aria-label="Join the party" className="card" style={{ padding: 22, display: 'flex', flexDirection: 'column', gap: 16 }}>
            {match && (
              <div className="field" style={{ gap: 8 }}>
                <span className="label">Pick your side</span>
                <TeamPicker config={match.config} value={team} onChange={setTeam} />
              </div>
            )}
            <button type="button" className="btn btn-primary btn-lg" disabled={joining} onClick={() => join(team)}>
              {joining && <Spinner />}Join party<ArrowRight size={16} strokeWidth={2.6} aria-hidden="true" />
            </button>
          </section>
        )}
      </div>
    </main>,
  );
}
