import { useEffect, useRef, useState } from 'react';
import { Check, Lock, Maximize, Minimize, Pause, Play, RotateCcw, RotateCw, Volume2, VolumeX } from 'lucide-react';
import { useYouTubePlayer } from '../../hooks/useYouTubePlayer.js';
import { usePlayerSync } from '../../hooks/usePlayerSync.js';
import { behindLive, playbackRange } from '../../lib/matchTime.js';
import { fmtDuration } from '../../lib/format.js';
import { Spinner } from '../ui.jsx';
import Scorebug from './Scorebug.jsx';
import SeekBar from './SeekBar.jsx';

/*
  The match player. YouTube supplies the picture; everything the viewer touches is ours.

  props:
    match, events            match row + normalized events
    position, now            authoritative position and server time (re-rendered by the parent)
    getTarget()              fresh authoritative position, used by the sync loop
    isPlaying, version       playback state (version bumps on every host change)
    controls                 { seek, skip, play, pause, goLive } or null for party guests
    hostName                 shown to guests
    variant                  'party' | 'solo'
    reactions                floating reactions [{ id, emoji, who, color, left, dx, dur }]
    overlay                  extra layer over the picture (party camera tiles)
*/
export default function VideoPlayer({
  match, events, position, now, getTarget, isPlaying, version, controls, hostName, pausedBy, variant = 'party', reactions = [], overlay = null,
}) {
  const containerRef = useRef(null);
  const { hostRef, playerRef, ready, error } = useYouTubePlayer(match.youtube_id);
  const [started, setStarted] = useState(false);
  const [volume, setVolume] = useState(80);
  const [muted, setMuted] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const sync = usePlayerSync({ playerRef, ready, started, getTarget, isPlaying, version });

  const live = match.mode === 'live';
  const config = match.config;
  const behind = live ? behindLive(config, position, now) : 0;
  const atLive = behind < 5;
  const { start, end } = playbackRange(config);
  const isHost = !!controls;

  useEffect(() => {
    const onFs = () => setFullscreen(document.fullscreenElement === containerRef.current);
    document.addEventListener('fullscreenchange', onFs);
    return () => document.removeEventListener('fullscreenchange', onFs);
  }, []);

  const join = () => {
    const p = playerRef.current;
    if (!p) return;
    p.seekTo(getTarget(), true);
    p.playVideo(); // inside the click so the browser allows sound
    p.unMute();
    p.setVolume(volume);
    setStarted(true);
  };

  const applyVolume = (v, m) => {
    const p = playerRef.current;
    if (!p) return;
    if (m || v === 0) p.mute(); else { p.unMute(); p.setVolume(v); }
  };
  const toggleMute = () => { setMuted((m) => { applyVolume(volume, !m); return !m; }); };
  const onVolume = (e) => {
    const v = Number(e.target.value);
    setVolume(v);
    setMuted(v === 0);
    applyVolume(v, v === 0);
  };
  const toggleFullscreen = () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else containerRef.current?.requestFullscreen?.();
  };

  const joinLabel = variant === 'party' ? 'Join the stream' : live ? 'Watch live' : 'Watch replay';
  const timeText = live
    ? atLive ? 'At live point' : `-${fmtDuration(behind)} behind live`
    : `${fmtDuration(position - start)} / ${fmtDuration(end - start)}`;

  return (
    <div ref={containerRef} className="player" data-youtube-video-id={match.youtube_id}>
      <div className="player-pitch" aria-hidden="true">
        <span style={{ left: '5%', right: '5%', top: '9%', bottom: '9%' }} />
        <span style={{ left: '50%', top: '9%', bottom: '9%', width: 0, borderWidth: '0 0 0 2px' }} />
      </div>
      <div ref={hostRef} className="player-frame" />
      {/* Clicks on a YouTube iframe toggle playback even with controls off. */}
      <div className="click-shield" aria-hidden="true" />
      {!isPlaying && started && <div className="player-dim" aria-hidden="true" />}

      {error != null ? (
        <div className="player-overlay">
          <strong>This video can't be played here</strong>
          <p>The uploader may have disabled embedding or it isn't available in your region.</p>
          <a className="btn btn-ghost btn-sm" href={`https://www.youtube.com/watch?v=${match.youtube_id}`} target="_blank" rel="noreferrer">Open on YouTube</a>
        </div>
      ) : !started ? (
        <div className="player-overlay">
          <button type="button" className="join-btn" onClick={join} disabled={!ready}>
            {ready ? <Play size={20} fill="currentColor" aria-hidden="true" /> : <Spinner size={18} />}
            {ready ? joinLabel : 'Loading stream…'}
          </button>
          <p>{variant === 'party' ? "You'll drop in at the same moment as everyone else in the party." : live ? 'Everyone watching is at the same live moment.' : 'Starts a few seconds before kick-off.'}</p>
        </div>
      ) : null}

      {started && !isPlaying && (isHost ? (
        <button type="button" className="big-play" onClick={controls.play} aria-label={variant === 'party' ? 'Resume playback for everyone' : 'Play'}>
          <Play size={30} fill="currentColor" aria-hidden="true" />
        </button>
      ) : (
        <div className="paused-chip" role="status"><Pause size={16} fill="currentColor" aria-hidden="true" />Paused by {pausedBy ?? hostName}</div>
      ))}

      <div className="reaction-layer" aria-hidden="true">
        {reactions.map((r) => (
          <div key={r.id} className="reaction-float" style={{ left: `${r.left}%`, animationDuration: `${r.dur}s`, '--dx': `${r.dx}px` }}>
            <span className="e">{r.emoji}</span>
            <span className="w" style={{ background: r.color }}>{r.who}</span>
          </div>
        ))}
      </div>

      {overlay}

      <Scorebug match={match} events={events} position={position} />

      <div className="player-status">
        {variant === 'party' && started && (
          <span role="status" className={`sync-pill ${sync === 'resync' ? 'resync' : ''}`}>
            {sync === 'resync' ? <Spinner size={13} /> : <Check size={13} strokeWidth={2.6} aria-hidden="true" />}
            <span>{sync === 'resync' ? 'Re-syncing…' : 'In sync'}</span>
          </span>
        )}
        {live ? (
          <span className={`status-live ${atLive ? '' : 'status-behind'}`}><span className="live-dot" />LIVE</span>
        ) : (
          <span className="status-ft">FULL TIME</span>
        )}
      </div>

      <div className="controls">
        {isHost && <SeekBar match={match} events={events} position={position} now={now} onSeek={controls.seek} />}
        <div className="controls-row">
          {isHost ? (
            <>
              <button type="button" className="ctrl" onClick={isPlaying ? controls.pause : controls.play} aria-label={isPlaying ? 'Pause' : 'Play'}>
                {isPlaying ? <Pause size={20} fill="currentColor" aria-hidden="true" /> : <Play size={20} fill="currentColor" aria-hidden="true" />}
              </button>
              <button type="button" className="ctrl" onClick={() => controls.skip(-10)} aria-label="Rewind 10 seconds">
                <RotateCcw size={22} aria-hidden="true" /><span className="num">10</span>
              </button>
              {(!live || !atLive) && (
                <button type="button" className="ctrl" onClick={() => controls.skip(10)} aria-label="Forward 10 seconds">
                  <RotateCw size={22} aria-hidden="true" /><span className="num">10</span>
                </button>
              )}
            </>
          ) : (
            <>
              <span className="guest-chip"><Lock size={13} strokeWidth={2.4} aria-hidden="true" /><span className="hide-xs">{hostName} controls playback</span></span>
            </>
          )}
          <button type="button" className="ctrl" onClick={toggleMute} aria-label={muted ? 'Unmute' : 'Mute'}>
            {muted ? <VolumeX size={20} aria-hidden="true" /> : <Volume2 size={20} aria-hidden="true" />}
          </button>
          <label htmlFor="vol" className="sr-only">Volume</label>
          <input id="vol" className="vol-range" type="range" min="0" max="100" value={muted ? 0 : volume} onChange={onVolume} />
          {isHost && <span className={`ctrl-time ${live && !atLive ? 'behind' : ''}`}>{timeText}</span>}
          <span className="spacer" />
          {live && isHost && (
            <button type="button" className="go-live" onClick={controls.goLive} disabled={atLive}>
              <span className="d" />{atLive ? 'LIVE' : 'Go Live'}
            </button>
          )}
          <button type="button" className="ctrl" onClick={toggleFullscreen} aria-label={fullscreen ? 'Exit fullscreen' : 'Fullscreen'}>
            {fullscreen ? <Minimize size={19} aria-hidden="true" /> : <Maximize size={19} aria-hidden="true" />}
          </button>
        </div>
      </div>
    </div>
  );
}
