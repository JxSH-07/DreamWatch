import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Eye, Lock, LogOut, Play, RotateCcw, Timer, Trash2, UserPlus } from 'lucide-react';
import Header from '../components/Header.jsx';
import CreatePartyModal from '../components/CreatePartyModal.jsx';
import { Avatar, ConfirmDialog, Loader, ModeBadge, TeamMark } from '../components/ui.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { useInvites } from '../context/InvitesContext.jsx';
import { useSubscriptionGate } from '../context/SubscriptionContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { useMatch, useMatches } from '../hooks/useMatch.js';
import { useNow } from '../hooks/useNow.js';
import { liveEdge, scoreAt, videoToMatchClock } from '../lib/matchTime.js';
import { shortName } from '../lib/format.js';
import { supabase } from '../lib/supabase.js';

function useViewerCount() {
  const [n, setN] = useState(() => 1_200_000 + Math.round(Math.random() * 40_000 - 20_000));
  useEffect(() => {
    const id = setInterval(() => setN((v) => v + Math.round(Math.random() * 3000 - 1500)), 4000);
    return () => clearInterval(id);
  }, []);
  return `${(n / 1_000_000).toFixed(2)}M`;
}

function GateIcon({ locked, children }) {
  return locked ? <Lock size={15} strokeWidth={2.4} aria-hidden="true" /> : children;
}

function LiveHero({ match, onParty }) {
  const { events } = useMatch(match.id);
  const now = useNow(1000);
  const viewers = useViewerCount();
  const navigate = useNavigate();
  const requireSubscription = useSubscriptionGate();
  const { isSubscribed } = useAuth();
  const config = match.config;
  const edge = liveEdge(config, now);
  const score = scoreAt(config, events, edge);
  const mc = videoToMatchClock(config, edge);
  const scorers = (team) => events.filter((e) => e.type === 'goal' && e.team === team && e.video_time <= edge).map((e) => `${shortName(e.player)} ${e.clock}`).join(', ');
  const a = scorers(config.home);
  const b = scorers(config.away);
  const watch = () => requireSubscription(() => navigate(`/watch/${match.id}`));

  return (
    <section id="live" className="hero" aria-label="Live now">
      <div className="deco-stripes" aria-hidden="true" />
      <div className="deco-line" aria-hidden="true" />
      <div className="deco-circle" aria-hidden="true" />
      <div className="deco-shade" aria-hidden="true" />
      <div className="hero-inner">
        <div className="hero-meta">
          <ModeBadge mode="live" />
          <span>{[config.competition, config.venue].filter(Boolean).join(' · ')}</span>
          <span className="viewers tab-num"><Eye size={16} strokeWidth={2} aria-hidden="true" />{viewers} watching</span>
        </div>
        <button type="button" onClick={watch} className="hero-teams" style={{ border: 0, background: 'transparent', color: 'inherit', cursor: 'pointer', padding: 0 }} aria-label={`Watch ${match.title} live`}>
          <div className="hero-team"><TeamMark team={config.home} config={config} /><span className="hero-team-name">{config.home}</span></div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
            <span className="hero-score">{score.home}–{score.away}</span>
            <span className="hero-clock">{mc.inPlay ? mc.clock : mc.short ?? mc.phase}</span>
          </div>
          <div className="hero-team"><TeamMark team={config.away} config={config} /><span className="hero-team-name">{config.away}</span></div>
        </button>
        {(a || b) && (
          <p className="hero-scorers tab-num">{[a && `${config.teams[config.home].short}: ${a}`, b && `${config.teams[config.away].short}: ${b}`].filter(Boolean).join('   ·   ')}</p>
        )}
        <div className="hero-actions">
          <button type="button" className="btn btn-outline btn-lg btn-lift" onClick={watch}>
            <GateIcon locked={!isSubscribed}><Play size={16} fill="currentColor" aria-hidden="true" /></GateIcon>Watch
          </button>
          <button type="button" className="btn btn-primary btn-lg btn-lift" onClick={() => requireSubscription(onParty)}>
            <GateIcon locked={!isSubscribed}><UserPlus size={18} strokeWidth={2.2} aria-hidden="true" /></GateIcon>Start Watch Party
          </button>
        </div>
      </div>
    </section>
  );
}

function ClassicCard({ match, onParty }) {
  const config = match.config;
  const navigate = useNavigate();
  const requireSubscription = useSubscriptionGate();
  const { isSubscribed } = useAuth();
  const fs = config.final_score ?? {};
  const date = config.date ? new Date(`${config.date}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) : '';
  const goals = (fs[config.home] ?? 0) + (fs[config.away] ?? 0);
  const minutes = Math.round((config.period_ends[String(Object.keys(config.period_ends).length)] - config.period_starts['1']) / 60);
  const stats = config.full_time_stats ?? {};
  const h = fs[config.home] ?? 0;
  const a = fs[config.away] ?? 0;
  const winner = h > a ? config.home : a > h ? config.away : null;

  return (
    <article className="classic">
      <div className="classic-art">
        <div className="s1" aria-hidden="true" />
        <div className="s2" aria-hidden="true" />
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span className="badge-ft">FULL TIME</span>
          <span style={{ fontSize: 13, color: 'var(--muted)' }}>{config.competition} · {config.venue?.split(',')[0]}</span>
        </div>
        <div className="classic-teams">
          <div className="classic-team"><TeamMark team={config.home} config={config} />{config.home}</div>
          <span className="cond tab-num" style={{ fontSize: 64, fontWeight: 800, lineHeight: 1 }}>{fs[config.home]}–{fs[config.away]}</span>
          <div className="classic-team"><TeamMark team={config.away} config={config} />{config.away}</div>
        </div>
        <span style={{ fontSize: 12, color: 'var(--muted-2)', textAlign: 'center' }}>{date}</span>
      </div>
      <div className="classic-body">
        <h3>{goals} goals at {config.venue?.split(',')[0] ?? 'the stadium'}</h3>
        <p>
          {winner ? `${winner} came out on top` : 'Honours even'} in {config.venue?.split(',').pop()?.trim()}
          {stats.shots ? ` — ${stats.shots} shots, ${stats.expected_goals} xG` : ''}. Rewatch the full match with your friends.
        </p>
        <ul className="meta-list">
          <li><Timer size={14} strokeWidth={2.4} aria-hidden="true" />{minutes} min</li>
          <li><RotateCcw size={14} strokeWidth={2.4} aria-hidden="true" />Host can pause and rewind</li>
          <li><Eye size={14} strokeWidth={2.4} aria-hidden="true" />Spoiler-free timeline</li>
        </ul>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 4 }}>
          <button type="button" className="btn btn-ghost btn-lift" style={{ borderColor: 'var(--line-4)' }} onClick={() => requireSubscription(() => navigate(`/watch/${match.id}`))}>
            <GateIcon locked={!isSubscribed}><Play size={15} fill="currentColor" aria-hidden="true" /></GateIcon>Watch replay
          </button>
          <button type="button" className="btn btn-primary btn-lift" onClick={() => requireSubscription(onParty)}>
            {!isSubscribed && <Lock size={15} strokeWidth={2.4} aria-hidden="true" />}Start Watch Party
          </button>
        </div>
      </div>
    </article>
  );
}

function YourParties({ matches }) {
  const { user } = useAuth();
  const { invites, reload: reloadInvites } = useInvites();
  const toast = useToast();
  const [rows, setRows] = useState([]);
  const [confirm, setConfirm] = useState(null); // { kind: 'delete' | 'leave' | 'decline', party }
  const [busy, setBusy] = useState(null);

  useEffect(() => {
    let active = true;
    supabase
      .from('party_members')
      .select('status, role, party:parties(id, name, status, match_id, host_id, created_at, deleted_at, host:profiles!parties_host_id_fkey(display_name, avatar_color))')
      .eq('user_id', user.id)
      .in('status', ['invited', 'joined'])
      .then(({ data }) => {
        if (!active) return;
        setRows((data ?? []).filter((r) => r.party && r.party.status !== 'ended' && !r.party.deleted_at)
          .sort((a, b) => b.party.created_at.localeCompare(a.party.created_at)));
      });
    return () => { active = false; };
  }, [user.id, invites]);
  const titles = useMemo(() => Object.fromEntries(matches.map((m) => [m.id, m])), [matches]);

  const run = async () => {
    const { kind, party } = confirm;
    setConfirm(null);
    setBusy(party.id);
    const { error } = await supabase.rpc(kind === 'delete' ? 'delete_party' : 'leave_party', { p_party: party.id });
    setBusy(null);
    if (error) {
      toast(kind === 'delete' ? "Couldn't delete the party — try again" : "Couldn't leave the party — try again", 'warn');
      return;
    }
    setRows((r) => r.filter((x) => x.party.id !== party.id));
    reloadInvites();
    toast(kind === 'delete' ? `Deleted ${party.name}` : kind === 'decline' ? 'Invite declined' : `You left ${party.name}`);
  };

  if (!rows.length) return null;
  const dialog = confirm && {
    delete: {
      title: `Delete ${confirm.party.name}?`,
      body: 'The party ends for everyone still watching, and it disappears from everyone\'s list. The invite link stops working. This can\'t be undone.',
      cta: 'Delete party',
    },
    leave: {
      title: `Leave ${confirm.party.name}?`,
      body: 'It will disappear from your parties. You can rejoin later with the invite link.',
      cta: 'Leave party',
    },
    decline: {
      title: `Decline the invite to ${confirm.party.name}?`,
      body: 'It will disappear from your parties and invites. You can still join later with the invite link.',
      cta: 'Decline',
    },
  }[confirm.kind];

  return (
    <section aria-labelledby="yp-h" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div className="section-head"><h2 id="yp-h">Your parties</h2></div>
      {rows.map(({ party, role, status }) => {
        const m = titles[party.match_id];
        const href = party.status === 'live' ? `/party/${party.id}` : status === 'joined' ? `/party/${party.id}/lobby` : `/invite/${party.id}`;
        const secondary = role === 'host' ? 'delete' : status === 'joined' ? 'leave' : 'decline';
        return (
          <div key={party.id} className="party-row">
            <Avatar name={party.host?.display_name} ring={party.host?.avatar_color} size={40} />
            <div className="info">
              <div className="t">{party.name}</div>
              <div className="d">
                {role === 'host' ? 'You host' : `${party.host?.display_name} invited you`} · {m?.title} · {party.status === 'live' ? 'Watching now' : 'In the lobby'}
              </div>
            </div>
            <div className="party-row-actions">
              <button
                type="button"
                className={`btn ${secondary === 'delete' ? 'btn-danger' : 'btn-ghost'}`}
                style={{ height: 44 }}
                disabled={busy === party.id}
                onClick={() => setConfirm({ kind: secondary, party })}
              >
                {secondary === 'delete' ? <Trash2 size={15} strokeWidth={2.2} aria-hidden="true" /> : <LogOut size={15} strokeWidth={2.2} aria-hidden="true" />}
                {secondary === 'delete' ? 'Delete' : secondary === 'leave' ? 'Leave' : 'Decline'}
              </button>
              <Link to={href} className="btn btn-primary btn-lift" style={{ height: 44 }}>{status === 'joined' ? 'Rejoin' : 'Join party'}</Link>
            </div>
          </div>
        );
      })}
      {dialog && (
        <ConfirmDialog title={dialog.title} body={dialog.body} cta={dialog.cta} danger
          onCancel={() => setConfirm(null)} onConfirm={run} />
      )}
    </section>
  );
}

export default function Home() {
  const { matches, loading } = useMatches();
  const [partyFor, setPartyFor] = useState(null);
  const listed = matches.filter((m) => m.config?.listed !== false);
  const live = listed.find((m) => m.mode === 'live');
  const classics = listed.filter((m) => m.mode === 'replay');

  return (
    <div className="page">
      <Header />
      <main className="container home-main">
        {loading && <Loader label="Loading matches…" />}
        {!loading && !matches.length && (
          <div className="empty-state" style={{ margin: '0 auto' }}>
            <p>No matches yet. Run the seed script (<code>npm run seed</code>) to load the two matches.</p>
          </div>
        )}
        {live && <LiveHero match={live} onParty={() => setPartyFor(live)} />}
        <YourParties matches={matches} />
        {classics.length > 0 && (
          <section id="classics" aria-labelledby="classic-h" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div className="section-head">
              <h2 id="classic-h">Watch party a classic</h2>
              <span>Full replays, rewatched together. Gaffer and the timeline only show what you've reached, so nobody gets spoiled.</span>
            </div>
            {classics.map((m) => <ClassicCard key={m.id} match={m} onParty={() => setPartyFor(m)} />)}
          </section>
        )}
      </main>
      {partyFor && <CreatePartyModal match={partyFor} onClose={() => setPartyFor(null)} />}
    </div>
  );
}
