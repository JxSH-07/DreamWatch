import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { Link2, LogOut, UserX } from 'lucide-react';
import { LogoMark, WhistleIcon, Wordmark } from '../components/Icons.jsx';
import { Avatar, Loader } from '../components/ui.jsx';
import VideoPlayer from '../components/player/VideoPlayer.jsx';
import ChatTab, { memberLook } from '../components/panel/ChatTab.jsx';
import TimelineTab, { useFreshEvents, visibleKeyEvents } from '../components/panel/TimelineTab.jsx';
import PollsTab, { Leaderboard, computeLeaderboard } from '../components/panel/PollsTab.jsx';
import PeopleTab from '../components/panel/PeopleTab.jsx';
import { CallAudio, CallControls, CallTile, PipTiles } from '../components/call/CallUI.jsx';
import { CallProvider, useCall } from '../context/CallContext.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { PartyProvider, useParty } from '../context/PartyContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { useMatch } from '../hooks/useMatch.js';
import { useNow } from '../hooks/useNow.js';
import { useLoopWrap } from '../hooks/useLoopWrap.js';
import { partyPosition, playbackPatch } from '../lib/playback.js';
import { playbackRange, scoreAt, videoToMatchClock } from '../lib/matchTime.js';
import { copyText, inviteLink, teamInfo } from '../lib/format.js';
import { serverNow } from '../lib/serverClock.js';
import { supabase } from '../lib/supabase.js';
import NotFound from './NotFound.jsx';
import { VideoResizer, usePlayerWidth } from '../components/VideoResizer.jsx';

const REACTIONS = [
  ['⚽', 'goal'], ['🔥', 'fire'], ['😱', 'shocked'], ['😂', 'laughing'], ['👏', 'applause'], ['🟨', 'yellow card'], ['🟥', 'red card'],
];
const FIRST_POLL_AFTER_S = 120;
const POLL_EVERY_S = 360;

// Host-only background jobs: full time, poll resolution/voiding and automatic polls (HANDOFF §9.5, §13).
function useHostAutomation({ match, position }) {
  const { party, polls, isHost, updateParty, rpc } = useParty();
  const busy = useRef(new Set());
  const fullTimeDone = useRef(false);
  const firstSeen = useRef(null);
  const nextPollAt = useRef(0);

  useEffect(() => {
    if (!isHost || !match || party?.status !== 'live') return;
    const config = match.config;

    if (match.mode === 'replay') {
      const { end } = playbackRange(config);
      if (party.is_playing && position >= end - 0.25 && !fullTimeDone.current) {
        fullTimeDone.current = true;
        updateParty(playbackPatch('pause', party, match, serverNow()));
        rpc('post_system_message', { p_party: party.id, p_body: "Full time — that's the match!" });
      }
      if (position < end - 5) fullTimeDone.current = false;
    }

    const open = polls.filter((p) => p.status === 'open');
    for (const p of open) {
      if (busy.current.has(p.id)) continue;
      if (position >= p.closes_at_video_time) {
        busy.current.add(p.id);
        rpc('resolve_poll', { p_poll: p.id }).finally(() => busy.current.delete(p.id));
      } else if (position < p.opens_at_video_time - 2) {
        busy.current.add(p.id);
        rpc('void_poll', { p_poll: p.id }).finally(() => busy.current.delete(p.id));
      }
    }

    if (open.length || busy.current.has('gen') || Date.now() < nextPollAt.current) return;
    if (!videoToMatchClock(config, position).inPlay) return;
    let due;
    if (!polls.length) {
      if (firstSeen.current == null) firstSeen.current = position;
      due = position - firstSeen.current >= FIRST_POLL_AFTER_S;
    } else {
      const lastOpen = Math.max(...polls.map((p) => Number(p.opens_at_video_time)));
      due = position - lastOpen >= POLL_EVERY_S;
    }
    if (!due) return;
    busy.current.add('gen');
    supabase.functions.invoke('generate-poll', { body: { party_id: party.id } }).then(({ error }) => {
      busy.current.delete('gen');
      nextPollAt.current = Date.now() + (error ? 60_000 : 30_000);
    });
  }, [isHost, match, party, polls, position, updateParty, rpc]);
}

function RoomHeader({ match, hostName }) {
  const { party, members, online, isHost } = useParty();
  const toast = useToast();
  const present = members.filter((m) => m.status === 'joined' && online.has(m.user_id));
  const share = async () => {
    const ok = await copyText(inviteLink(party.id));
    toast(ok ? 'Invite link copied' : "Couldn't copy the link", ok ? 'ok' : 'warn');
  };
  return (
    <header className="room-header">
      <Link to="/" className="logo" aria-label="Back to Dream Watch home">
        <LogoMark size={28} />
        <Wordmark className="hide-md" />
      </Link>
      <span className="sep hide-md" aria-hidden="true" />
      <div className="title">
        <span className="k">{match.mode === 'live' ? 'Live watch party' : 'Replay watch party'} · {match.title}</span>
        <span className="n">{party.name}</span>
      </div>
      <span className={`badge-role ${isHost ? 'host' : 'guest'} hide-xs`} title={isHost ? 'You control playback' : `${hostName} controls playback`}>{isHost ? 'HOST' : 'GUEST'}</span>
      <div className="right">
        <div className="hide-md" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div className="avatar-stack">
            {present.slice(0, 5).map((m) => {
              const look = memberLook(m, match.config);
              return <Avatar key={m.user_id} name={look.name} ring={look.ring} size={28} />;
            })}
          </div>
          <span className="tab-num" style={{ fontSize: 13, color: 'var(--muted)' }}>{present.length} watching</span>
        </div>
        <button type="button" className="btn btn-ghost btn-sm" onClick={share}><Link2 size={15} strokeWidth={2} aria-hidden="true" /><span className="hide-xs">Share</span></button>
        <Link to="/" className="btn btn-ghost btn-sm" style={{ color: 'var(--muted)' }}><LogOut size={15} strokeWidth={2} aria-hidden="true" /><span className="hide-xs">Leave</span></Link>
      </div>
    </header>
  );
}

function ParticipantStrip({ match, hostId }) {
  const { user } = useAuth();
  const { members, online } = useParty();
  const { media, layout, speaking, tileWidths, setTileWidth } = useCall();
  const stripResize = { corner: 'br', onResize: (w) => setTileWidth('strip', w), onReset: () => setTileWidth('strip', null) };
  const joined = members.filter((m) => m.status === 'joined');
  return (
    <div className="strip" aria-label="Participants">
      {joined.map((m) => {
        const look = memberLook(m, match.config);
        const team = m.team_supported ? teamInfo(match.config, m.team_supported) : null;
        const isOnline = online.has(m.user_id);
        const call = media[m.user_id];
        const showTile = layout === 'strip' && call?.video;
        const isSpeaking = speaking.has(m.user_id);
        return (
          <div key={m.user_id} className={`strip-item ${isOnline ? '' : 'offline'} ${showTile ? 'has-cam' : ''}`} style={showTile ? { width: tileWidths.strip } : undefined} title={isOnline ? 'Online' : 'Offline'}>
            {showTile ? (
              <CallTile stream={call.stream} version={call.version} name={look.name} ring={look.ring} self={call.self}
                micOff={!call.mic} speaking={isSpeaking} width={tileWidths.strip} resize={stripResize} />
            ) : (
              <Avatar name={look.name} ring={look.ring} size={46} online={isOnline} className={isSpeaking ? 'speaking' : ''}>
                {m.muted && <span className="muted-badge" title="Muted in chat"><UserX size={10} strokeWidth={3} aria-hidden="true" /></span>}
              </Avatar>
            )}
            <span className="nm">{m.user_id === user.id ? 'You' : look.name}</span>
            <span className="tm" style={{ color: team?.text ?? 'var(--muted-3)' }}>{m.user_id === hostId ? 'HOST · ' : ''}{team?.short ?? '—'}</span>
          </div>
        );
      })}
    </div>
  );
}

function EndedScreen({ match, events }) {
  const { user } = useAuth();
  const { party, polls, votes, members, messages } = useParty();
  const config = match.config;
  const at = Number(party.anchor_position ?? playbackRange(config).start);
  const score = scoreAt(config, events, at);
  const mc = videoToMatchClock(config, at);
  const questions = messages.filter((m) => m.author_type === 'gaffer' && m.reply_to).length;
  return (
    <div className="state-screen">
      <div className="state-card" role="dialog" aria-modal="true" aria-labelledby="end-t">
        <span style={{ color: 'var(--accent)' }}><WhistleIcon size={44} strokeWidth={1.8} /></span>
        <h2 id="end-t">Party ended</h2>
        <p>{party.deleted_at ? `The host deleted ${party.name}.` : `${party.name} is over.`} Thanks for watching together.</p>
        <div className="recap">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <span className="cond" style={{ fontSize: 22, fontWeight: 700 }}>{config.home} {score.home}–{score.away} {config.away}</span>
            <span className="tab-num" style={{ fontSize: 13, color: 'var(--muted-2)' }}>{mc.inPlay ? mc.minute : mc.phase}</span>
          </div>
          <span style={{ fontSize: 13, color: 'var(--muted)' }}>Gaffer answered {questions} {questions === 1 ? 'question' : 'questions'} · {polls.filter((p) => p.status === 'resolved').length} polls settled</span>
          <h3 className="sub-h">Prediction leaderboard</h3>
          <Leaderboard rows={computeLeaderboard(polls, votes, members)} config={config} meId={user.id} />
        </div>
        <Link to="/" className="btn btn-primary" style={{ marginTop: 8 }}>Back to Home</Link>
      </div>
    </div>
  );
}

function RemovedScreen() {
  return (
    <div className="state-screen">
      <div className="state-card" role="alertdialog" aria-modal="true" aria-labelledby="rm-t">
        <h2 id="rm-t">You were removed</h2>
        <p>The host removed you from this party.</p>
        <Link to="/" className="btn btn-primary">Back to Home</Link>
      </div>
    </div>
  );
}

function RoomInner() {
  const { user } = useAuth();
  const toast = useToast();
  const { partyId, party: row, members, me, isHost, messages, polls, votes, reactions, memberMap, loading, loadError, updateParty, playbackAction, react, rpc } = useParty();
  const { match, events, keyEvents } = useMatch(row?.match_id);
  const now = useNow(500);
  const [tab, setTab] = useState('chat');
  const [composer, setComposer] = useState({ draft: '', eventId: null, replyTo: null });
  const [focusKey, setFocusKey] = useState(0);
  const [highlight, setHighlight] = useState(null);
  const [unreadChat, setUnreadChat] = useState(0);
  const [unreadTl, setUnreadTl] = useState(0);
  const lastReact = useRef(0);
  const gridRef = useRef(null);
  const playerBoxRef = useRef(null);
  const [playerWidth, setPlayerWidth] = usePlayerWidth();
  const rowRef = useRef(row);
  rowRef.current = row;

  const position = match && row
    ? row.status === 'live' ? partyPosition(row, match, now) : Number(row.anchor_position ?? playbackRange(match.config).start)
    : 0;

  useHostAutomation({ match, position });

  // Unread counters for tabs that aren't open.
  const msgCount = useRef(messages.length);
  useEffect(() => {
    const added = messages.length - msgCount.current;
    msgCount.current = messages.length;
    if (added > 0 && tab !== 'chat') setUnreadChat((n) => n + added);
  }, [messages.length, tab]);
  const fresh = useFreshEvents(
    match ? visibleKeyEvents(keyEvents, position).map((e) => e.id) : [],
    (n) => tab !== 'timeline' && setUnreadTl((u) => u + n),
  );

  useLoopWrap(match, now, () => {
    toast('The broadcast restarted from kick-off.');
    if (!isHost) return;
    const r = rowRef.current;
    updateParty({ live_delay_s: 0, is_playing: true, playback_version: (r.playback_version ?? 0) + 1 });
    polls.filter((p) => p.status === 'open').forEach((p) => rpc('void_poll', { p_poll: p.id }));
  });

  // Everyone in the party controls playback unless the host turned shared controls off.
  const canControl = isHost || row?.settings?.shared_controls !== false;
  const act = (action, arg) => {
    const r = rowRef.current;
    const now = serverNow();
    const patch = playbackPatch(action, r, match, now, arg);
    if (!patch) return;
    const label = videoToMatchClock(match.config, partyPosition({ ...r, ...patch }, match, now)).clock;
    const name = action === 'skip' ? (arg < 0 ? 'skip_back' : 'skip_forward') : action === 'goLive' ? 'go_live' : action;
    playbackAction(name, patch, action === 'seek' || action === 'skip' ? label : null);
  };
  const controls = useMemo(() => (canControl ? {
    seek: (t) => act('seek', t),
    skip: (d) => act('skip', d),
    play: () => act('play'),
    pause: () => act('pause'),
    goLive: () => act('goLive'),
  } : null), [canControl, match]); // eslint-disable-line react-hooks/exhaustive-deps

  const getTarget = useCallback(() => (match && rowRef.current ? partyPosition(rowRef.current, match, serverNow()) : 0), [match]);

  const openTab = (t) => {
    setTab(t);
    if (t === 'chat') setUnreadChat(0);
    if (t === 'timeline') setUnreadTl(0);
  };
  const askAbout = (e) => {
    setComposer({ draft: '@Gaffer explain this ', eventId: e.id, replyTo: null });
    openTab('chat');
    setFocusKey((k) => k + 1);
  };
  const showEvent = (id) => {
    if (!id) return;
    openTab('timeline');
    setHighlight(id);
    setTimeout(() => setHighlight(null), 3000);
  };
  const sendReaction = (emoji) => {
    if (Date.now() - lastReact.current < 300) return;
    lastReact.current = Date.now();
    react(emoji);
  };
  const endParty = () => updateParty({
    status: 'ended', ended_at: new Date().toISOString(), is_playing: false,
    anchor_position: position, anchor_time: serverNow(), playback_version: (row.playback_version ?? 0) + 1,
  });

  if (loading) return <Loader label="Joining the party…" />;
  if (loadError === 'removed' || me?.status === 'removed') return <RemovedScreen />;
  if (loadError === 'left') return <Navigate to={`/invite/${partyId}`} replace />;
  if (loadError || !row) return <NotFound embedded />;
  if (!me || me.status !== 'joined') return <Navigate to={`/invite/${partyId}`} replace />;
  if (row.status === 'lobby') return <Navigate to={`/party/${partyId}/lobby`} replace />;
  if (!match) return <Loader label="Loading match…" />;

  const hostMember = members.find((m) => m.role === 'host');
  const hostName = hostMember?.profile?.display_name ?? 'The host';
  const floating = reactions.map((r) => {
    const look = memberLook(memberMap[r.userId], match.config);
    return { ...r, who: r.userId === user.id ? 'You' : look.name, color: look.ring };
  });
  const pollsBadge = polls.filter((p) => p.status === 'open' && position < p.votes_close_at_video_time && !votes.some((v) => v.poll_id === p.id && v.user_id === user.id)).length;
  const joinedCount = members.filter((m) => m.status === 'joined').length;
  const tabs = [
    { id: 'chat', label: 'Chat', badge: unreadChat },
    { id: 'timeline', label: 'Timeline', badge: unreadTl, warn: true },
    { id: 'polls', label: 'Polls', badge: pollsBadge },
    { id: 'people', label: `People · ${joinedCount}`, badge: 0 },
  ];

  const callPeople = members.filter((m) => m.status === 'joined').map((m) => {
    const look = memberLook(m, match.config);
    return { userId: m.user_id, name: look.name, ring: look.ring };
  });

  return (
    <CallProvider active={row.status === 'live'}>
      <CallAudio />
      <RoomHeader match={match} hostName={hostName} />
      <div className={`room-grid ${playerWidth ? 'custom-w' : ''}`} ref={gridRef} style={playerWidth ? { '--player-w': `${playerWidth}px` } : undefined}>
        <section className="room-player" aria-label="Match player">
          <div className="player-box" ref={playerBoxRef}>
            <VideoPlayer
              match={match} events={events} position={position} now={now} getTarget={getTarget}
              isPlaying={row.status === 'live' && row.is_playing} version={row.playback_version}
              controls={controls} hostName={hostName} variant="party" reactions={floating}
              pausedBy={memberMap[row.playback_by]?.profile?.display_name ?? hostName}
              resumeKey={`dw.joined.${partyId}`}
              overlay={<PipTiles people={callPeople} isHost={!!controls} />}
            />
            <VideoResizer width={playerWidth} setWidth={setPlayerWidth} containerRef={gridRef} playerRef={playerBoxRef} />
          </div>
        </section>

        <section className="room-below" aria-label="Reactions and people">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <div className="react-bar" role="group" aria-label="Send a reaction">
              {REACTIONS.map(([emoji, label]) => (
                <button key={emoji} type="button" className="react-btn" aria-label={`React ${label}`} onClick={() => sendReaction(emoji)}>{emoji}</button>
              ))}
            </div>
            <span className="hide-md" style={{ fontSize: 12, color: 'var(--muted-3)' }}>Everyone sees reactions</span>
            <CallControls />
          </div>
          <ParticipantStrip match={match} hostId={row.host_id} />
        </section>

        <aside className="room-side" aria-label="Party panel">
          <div className="side-panel">
            <div className="tabs" role="tablist" aria-label="Party panel sections">
              {tabs.map((t) => (
                <button key={t.id} type="button" role="tab" className="tab" aria-selected={tab === t.id} onClick={() => openTab(t.id)}>
                  <span>{t.label}</span>
                  {t.badge > 0 && tab !== t.id && <span className={`tab-badge ${t.warn ? 'warn' : ''}`}>{t.badge}</span>}
                </button>
              ))}
            </div>
            {tab === 'chat' && (
              <ChatTab match={match} events={events} position={position} composer={composer} setComposer={setComposer}
                onAboutClick={showEvent} onPollsClick={() => openTab('polls')} focusKey={focusKey} />
            )}
            {tab === 'timeline' && (
              <TimelineTab match={match} keyEvents={keyEvents} position={position} now={now} fresh={fresh} highlightId={highlight}
                onAsk={askAbout} onJump={controls ? (e) => controls.seek(e.video_time - 8) : null} onGoLive={controls ? controls.goLive : null} />
            )}
            {tab === 'polls' && <PollsTab match={match} position={position} />}
            {tab === 'people' && <PeopleTab match={match} onEnd={endParty} />}
          </div>
        </aside>
      </div>
      {row.status === 'ended' && <EndedScreen match={match} events={events} />}
    </CallProvider>
  );
}

export default function Room() {
  const { partyId } = useParams();
  const { isSubscribed } = useAuth();
  if (!isSubscribed) return <Navigate to={`/invite/${partyId}`} replace />;
  return (
    <div className="page">
      <PartyProvider partyId={partyId}>
        <RoomInner />
      </PartyProvider>
    </div>
  );
}
