import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Lock, UserPlus } from 'lucide-react';
import Header from '../components/Header.jsx';
import VideoPlayer from '../components/player/VideoPlayer.jsx';
import TimelineTab, { useFreshEvents, visibleKeyEvents } from '../components/panel/TimelineTab.jsx';
import CreatePartyModal from '../components/CreatePartyModal.jsx';
import { Loader, ModeBadge } from '../components/ui.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { useSubscriptionGate } from '../context/SubscriptionContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { useMatch } from '../hooks/useMatch.js';
import { useNow } from '../hooks/useNow.js';
import { useLoopWrap } from '../hooks/useLoopWrap.js';
import { initialPlayback, partyPosition, playbackPatch } from '../lib/playback.js';
import { playbackRange } from '../lib/matchTime.js';
import { serverNow } from '../lib/serverClock.js';
import NotFound from './NotFound.jsx';
import { VideoResizer, usePlayerWidth } from '../components/VideoResizer.jsx';

// Solo viewing: the same player, with playback state kept locally instead of in the DB.
function SoloPlayer({ match, events, keyEvents }) {
  const toast = useToast();
  const [state, setState] = useState(() => initialPlayback(match, serverNow()));
  const stateRef = useRef(state);
  const gridRef = useRef(null);
  const playerBoxRef = useRef(null);
  const [playerWidth, setPlayerWidth] = usePlayerWidth();
  stateRef.current = state;
  const now = useNow(500);
  const position = partyPosition(state, match, now);

  const apply = useCallback((action, arg) => {
    setState((s) => {
      const patch = playbackPatch(action, s, match, serverNow(), arg);
      return patch ? { ...s, ...patch } : s;
    });
  }, [match]);
  const controls = useMemo(() => ({
    seek: (t) => apply('seek', t),
    skip: (d) => apply('skip', d),
    play: () => apply('play'),
    pause: () => apply('pause'),
    goLive: () => apply('goLive'),
  }), [apply]);
  const getTarget = useCallback(() => partyPosition(stateRef.current, match, serverNow()), [match]);

  useLoopWrap(match, now, () => {
    apply('goLive');
    toast('The broadcast restarted from kick-off.');
  });
  const atEnd = match.mode === 'replay' && state.is_playing && position >= playbackRange(match.config).end - 0.25;
  useEffect(() => {
    if (atEnd) apply('pause');
  }, [atEnd, apply]);

  const fresh = useFreshEvents(visibleKeyEvents(keyEvents, position).map((e) => e.id));

  return (
    <div className={`watch-grid ${playerWidth ? 'custom-w' : ''}`} ref={gridRef} style={playerWidth ? { '--player-w': `${playerWidth}px` } : undefined}>
      <div className="watch-main">
        <div className="player-box" ref={playerBoxRef}>
          <VideoPlayer
            match={match} events={events} position={position} now={now} getTarget={getTarget}
            isPlaying={state.is_playing} version={state.playback_version} controls={controls} variant="solo"
            resumeKey={`dw.watching.${match.id}`}
          />
          <VideoResizer width={playerWidth} setWidth={setPlayerWidth} containerRef={gridRef} playerRef={playerBoxRef} />
        </div>
        <div className="watch-title">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <ModeBadge mode={match.mode} small />
            <span style={{ fontSize: 13, color: 'var(--muted)' }}>{match.config.competition}</span>
          </div>
          <h1>{match.title}</h1>
        </div>
      </div>
      <aside className="watch-side">
        <StartPartyCard match={match} />
        <div className="tl-box">
          <TimelineTab match={match} keyEvents={keyEvents} position={position} now={now} fresh={fresh}
            onJump={(e) => controls.seek(e.video_time - 8)} />
        </div>
      </aside>
    </div>
  );
}

function StartPartyCard({ match }) {
  const [open, setOpen] = useState(false);
  const requireSubscription = useSubscriptionGate();
  return (
    <section className="cta-card">
      <h2>Start a Watch Party</h2>
      <p>Watch with friends and ask Gaffer anything. Everyone stays on the same moment, with a shared chat, reactions and prediction polls.</p>
      <button type="button" className="btn btn-primary" style={{ alignSelf: 'flex-start' }} onClick={() => requireSubscription(() => setOpen(true))}>
        <UserPlus size={17} strokeWidth={2.2} aria-hidden="true" />Start Watch Party
      </button>
      {open && <CreatePartyModal match={match} onClose={() => setOpen(false)} />}
    </section>
  );
}

function LockedPlayer({ match }) {
  const requireSubscription = useSubscriptionGate();
  return (
    <div className="watch-grid">
      <div className="watch-main">
        <div className="player">
          <div className="player-overlay">
            <span className="lock-ic"><Lock size={18} strokeWidth={2.2} aria-hidden="true" /></span>
            <strong>Subscribe to watch {match.title}</strong>
            <p>Live and classic matches, watch parties and Gaffer are part of Dream Watch Premium.</p>
            <button type="button" className="btn btn-primary" onClick={() => requireSubscription()}>Subscribe</button>
          </div>
        </div>
        <div className="watch-title"><h1>{match.title}</h1></div>
      </div>
    </div>
  );
}

export default function Watch() {
  const { matchId } = useParams();
  const { isSubscribed, loading: authLoading } = useAuth();
  const { match, events, keyEvents, loading, error } = useMatch(matchId);

  let body;
  if (loading || authLoading) body = <Loader label="Loading match…" />;
  else if (error || !match) return <NotFound />;
  else if (!isSubscribed) body = <LockedPlayer match={match} />;
  else body = <SoloPlayer key={match.id} match={match} events={events} keyEvents={keyEvents} />;

  return (
    <div className="page">
      <Header />
      {body}
    </div>
  );
}
