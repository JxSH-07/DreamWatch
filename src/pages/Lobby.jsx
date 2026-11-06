import { useEffect, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { ArrowRight, Check, Copy, RefreshCw } from 'lucide-react';
import Header from '../components/Header.jsx';
import TestingAloneHint from '../components/TestingAloneHint.jsx';
import { Avatar, Loader, ModeBadge, PitchCard, Spinner } from '../components/ui.jsx';
import { memberLook } from '../components/panel/ChatTab.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { PartyProvider, useParty } from '../context/PartyContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { useMatch } from '../hooks/useMatch.js';
import { useNow } from '../hooks/useNow.js';
import { liveEdge, playbackRange, scoreAt, videoToMatchClock } from '../lib/matchTime.js';
import { NEUTRAL, copyText, inviteLink, teamInfo } from '../lib/format.js';
import { serverNow } from '../lib/serverClock.js';
import NotFound from './NotFound.jsx';

export function MatchStrip({ match, events }) {
  const now = useNow(1000);
  const config = match.config;
  const live = match.mode === 'live';
  const home = teamInfo(config, config.home);
  const away = teamInfo(config, config.away);
  const edge = live ? liveEdge(config, now) : null;
  const score = live ? scoreAt(config, events, edge) : { home: 0, away: 0 };
  const mc = live ? videoToMatchClock(config, edge) : null;
  return (
    <PitchCard>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <ModeBadge mode={match.mode} small />
          <span style={{ fontSize: 13, color: 'var(--muted)' }}>{config.competition}{live ? '' : ' · Replay'}</span>
        </div>
        <div className="match-strip">
          <div className="side"><span className="bar" style={{ background: home.color }} />{home.name}</div>
          <div className="mid">
            <span className="score">{score.home}–{score.away}</span>
            <span className="clock">{live ? (mc.inPlay ? mc.clock : mc.short ?? mc.phase) : 'Starts from kick-off'}</span>
          </div>
          <div className="side r">{away.name}<span className="bar" style={{ background: away.color }} /></div>
        </div>
      </div>
    </PitchCard>
  );
}

export function TeamPicker({ config, value, onChange }) {
  const opts = [config.home, config.away, 'Neutral'];
  return (
    <div className="segmented" role="group" aria-label="Pick your side">
      {opts.map((t) => {
        const info = t === 'Neutral' ? NEUTRAL : teamInfo(config, t);
        return (
          <button key={t} type="button" aria-pressed={(value ?? 'Neutral') === t} onClick={() => onChange(t)}>
            <span className="swatch" style={{ background: info.color }} />{t}
          </button>
        );
      })}
    </div>
  );
}

function LobbyInner() {
  const { user } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const { partyId, party, members, me, isHost, online, loading, loadError, updateParty, updateMember } = useParty();
  const { match, events } = useMatch(party?.match_id);
  const [copied, setCopied] = useState(false);
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    if (party?.status === 'live') navigate(`/party/${party.id}`, { replace: true });
  }, [party?.status, party?.id, navigate]);

  if (loading) return <Loader label="Opening the lobby…" />;
  if (loadError === 'removed' || loadError === 'left') return <Navigate to={`/invite/${partyId}`} replace />;
  if (loadError || !party) return <NotFound embedded />;
  if (!me || me.status !== 'joined') return <Navigate to={`/invite/${party.id}`} replace />;
  if (party.status === 'ended') return <Navigate to={`/party/${party.id}`} replace />;
  if (!match) return <Loader label="Loading match…" />;

  const config = match.config;
  const link = inviteLink(party.id);
  const host = members.find((m) => m.role === 'host');
  const hostName = host?.profile?.display_name ?? 'The host';
  const list = members.filter((m) => m.status === 'joined' || m.status === 'invited');
  const joined = list.filter((m) => m.status === 'joined');

  const copy = async () => {
    const ok = await copyText(link);
    setCopied(ok);
    if (!ok) toast("Couldn't copy — select the link instead", 'warn');
    setTimeout(() => setCopied(false), 2000);
  };

  const start = async () => {
    setStarting(true);
    const now = serverNow();
    const anchor = match.mode === 'live' ? liveEdge(config, now) : playbackRange(config).start;
    const ok = await updateParty({
      status: 'live', anchor_position: anchor, anchor_time: now, is_playing: true, live_delay_s: 0,
      playback_version: (party.playback_version ?? 0) + 1,
    });
    setStarting(false);
    if (ok) navigate(`/party/${party.id}`);
  };

  return (
    <main className="container lobby-main">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span className="kicker">{isHost ? 'Your ' : `${hostName}'s `}{match.mode === 'live' ? 'live' : 'replay'} watch party · lobby</span>
        <h1 className="h-cond" style={{ fontSize: 48 }}>{party.name}</h1>
      </div>

      <div className="lobby-grid">
        <div className="lobby-col">
          <MatchStrip match={match} events={events} />

          <section aria-labelledby="link-h" className="card card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              <h2 id="link-h" className="card-title">Invite link</h2>
              <span className="card-sub">Anyone with a Dream Watch subscription can join with this link</span>
            </div>
            <div className="copy-row">
              <label htmlFor="lb-link" className="sr-only">Invite link</label>
              <input id="lb-link" className="input" readOnly value={link} onFocus={(e) => e.target.select()} />
              <button type="button" className="btn btn-soft" style={{ minWidth: 112, borderColor: copied ? 'var(--accent)' : undefined, color: copied ? 'var(--accent)' : undefined }} onClick={copy}>
                {copied ? <Check size={15} strokeWidth={3} aria-hidden="true" /> : <Copy size={15} strokeWidth={2} aria-hidden="true" />}
                {copied ? 'Copied' : 'Copy link'}
              </button>
            </div>
          </section>

          <div className="hint-box">
            <RefreshCw size={20} strokeWidth={2} style={{ color: 'var(--accent)', flexShrink: 0, marginTop: 1 }} aria-hidden="true" />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              <span className="t">Playback is synced for everyone</span>
              <span className="b">
                {match.mode === 'live'
                  ? 'Everyone watches the same moment of the live stream, so a goal never gets spoiled in the chat. Anyone in the party can rewind and bring everyone back to live, and the chat shows who did it.'
                  : 'Anyone in the party can pause, rewind and skip for everyone, and the chat shows who did it. The timeline and Gaffer only show what the party has already watched.'}
              </span>
            </div>
          </div>

          <TestingAloneHint partyId={party.id} />
        </div>

        <section aria-labelledby="ppl-h" className="card card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
            <h2 id="ppl-h" className="card-title">Participants</h2>
            <span className="tab-num card-sub">{joined.length} of {list.length} joined</span>
          </div>
          <ul className="member-list">
            {list.map((m) => {
              const look = memberLook(m, config);
              const team = m.team_supported ? teamInfo(config, m.team_supported) : null;
              const isOnline = online.has(m.user_id);
              return (
                <li key={m.user_id} className="member-row">
                  <Avatar name={look.name} ring={look.ring} size={40} online={isOnline} dim={m.status !== 'joined'} />
                  <div className="who">
                    <span className="name">{look.name}{m.user_id === user.id ? ' (you)' : ''}</span>
                    <span className="sub">{m.role === 'host' ? 'Host · ' : ''}{team?.name ?? 'No side picked'}{m.status === 'joined' ? (isOnline ? ' · Online' : ' · Offline') : ''}</span>
                  </div>
                  {m.status === 'joined'
                    ? <span className="pill pill-ok pop"><span className="pill-dot" />Joined</span>
                    : <span className="pill pill-neutral">Invited</span>}
                </li>
              );
            })}
          </ul>

          <div className="field" style={{ gap: 8 }}>
            <span className="label">Pick your side</span>
            <TeamPicker config={config} value={me.team_supported} onChange={(t) => updateMember(user.id, { team_supported: t })} />
          </div>

          <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 8, paddingTop: 6 }}>
            {isHost ? (
              <button type="button" className="btn btn-primary btn-lg" onClick={start} disabled={starting}>
                {starting && <Spinner />}Start party<ArrowRight size={16} strokeWidth={2.6} aria-hidden="true" />
              </button>
            ) : (
              <div className="btn btn-ghost btn-lg" role="status" style={{ cursor: 'default' }}>
                <Spinner />Waiting for {hostName} to start…
              </div>
            )}
            <span style={{ fontSize: 12, color: 'var(--muted-3)' }}>
              {isHost
                ? "Everyone in the lobby moves into the room together. Friends still joining drop straight in when they're ready."
                : party.settings?.shared_controls === false
                  ? `${hostName} controls playback. You can chat, react and ask Gaffer.`
                  : 'Everyone can pause and rewind, chat, react and ask Gaffer.'}
            </span>
          </div>
        </section>
      </div>
    </main>
  );
}

export default function Lobby() {
  const { partyId } = useParams();
  const { isSubscribed } = useAuth();
  if (!isSubscribed) return <Navigate to={`/invite/${partyId}`} replace />;
  return (
    <div className="page">
      <Header nav={false} />
      <PartyProvider partyId={partyId}>
        <LobbyInner />
      </PartyProvider>
    </div>
  );
}
