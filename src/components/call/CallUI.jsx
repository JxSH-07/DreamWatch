import { useEffect, useRef, useState } from 'react';
import { Mic, MicOff, Video, VideoOff } from 'lucide-react';
import { useCall } from '../../context/CallContext.jsx';
import { useParty } from '../../context/PartyContext.jsx';
import { initial } from '../../lib/format.js';
import { ConfirmDialog } from '../ui.jsx';

function tint(hex, a) {
  if (!/^#[0-9a-f]{6}$/i.test(hex ?? '')) return `rgba(42,52,80,${a})`;
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

// Grip on a tile's corner. Dragging resizes every camera tile in that layout (5:3).
// corner 'br' grows down-right (strip); 'tl' grows up-left (tiles anchored bottom-right on the video).
function TileResizeGrip({ corner, width, onResize, onReset }) {
  const drag = useRef(null);
  const [active, setActive] = useState(false);
  const sign = corner === 'tl' ? -1 : 1;

  const onPointerDown = (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    drag.current = { x: e.clientX, y: e.clientY, w: width };
    e.currentTarget.setPointerCapture(e.pointerId);
    setActive(true);
  };
  const onPointerMove = (e) => {
    if (!drag.current) return;
    const dx = e.clientX - drag.current.x;
    const dy = (e.clientY - drag.current.y) / TILE_RATIO;
    onResize(drag.current.w + sign * (Math.abs(dx) > Math.abs(dy) ? dx : dy));
  };
  const end = () => {
    drag.current = null;
    setActive(false);
  };
  const onKeyDown = (e) => {
    const step = e.shiftKey ? 48 : 16;
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === '+') { e.preventDefault(); onResize(width + step); }
    if (e.key === 'ArrowLeft' || e.key === 'ArrowDown' || e.key === '-') { e.preventDefault(); onResize(width - step); }
    if (e.key === 'Escape') { e.preventDefault(); onReset(); }
  };

  return (
    <button
      type="button"
      className={`cam-resize ${corner} ${active ? 'active' : ''}`}
      aria-label="Resize camera tiles"
      title="Drag to resize cameras · double-click to reset"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={end}
      onPointerCancel={end}
      onDoubleClick={onReset}
      onKeyDown={onKeyDown}
    >
      <svg width="10" height="10" viewBox="0 0 12 12" aria-hidden="true">
        <path d="M11 3 3 11M11 7 7 11" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    </button>
  );
}

const TILE_RATIO = 0.6; // height / width

// A participant's camera tile. Audio plays through <CallAudio>, so video is always muted here.
// `resize` = { corner, onResize(width), onReset() } adds a drag grip.
export function CallTile({ stream, version, name, ring, self, micOff, speaking, width = 120, label, resize }) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.srcObject = null;
    el.srcObject = stream ?? null;
    el.play?.().catch(() => {});
  }, [stream, version]);

  return (
    <span
      className={`cam-tile ${speaking ? 'speaking' : ''}`}
      role="group"
      aria-label={label ?? `${self ? 'Your' : `${name}'s`} camera${micOff ? ', mic off' : ''}`}
      style={{ width, borderColor: ring, background: `linear-gradient(160deg, ${tint(ring, 0.38)} 0%, #101727 75%)` }}
    >
      <video ref={ref} autoPlay playsInline muted className={self ? 'mirror' : ''} />
      {!stream && <span className="cam-init" aria-hidden="true">{initial(name)}</span>}
      <span className="cam-name">{self ? 'You' : name}</span>
      {micOff && (
        <span className="cam-mic-off" title="Mic off"><MicOff size={9} strokeWidth={3} aria-hidden="true" /></span>
      )}
      {resize && <TileResizeGrip corner={resize.corner} width={width} onResize={resize.onResize} onReset={resize.onReset} />}
    </span>
  );
}

function RemoteAudio({ stream, version }) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.srcObject = stream;
    el.play?.().catch(() => {});
  }, [stream, version]);
  return <audio ref={ref} autoPlay />;
}

// Plays every remote participant's audio, whatever the camera layout.
export function CallAudio() {
  const { media } = useCall();
  return (
    <div hidden>
      {Object.entries(media)
        .filter(([, m]) => !m.self && m.stream && m.mic)
        .map(([id, m]) => <RemoteAudio key={id} stream={m.stream} version={m.version} />)}
    </div>
  );
}

export function CallControls() {
  const { camOn, micOn, toggleCam, toggleMic, layout, setLayout, allowCameras, askConsent, confirmCam, cancelConsent } = useCall();
  const { party, isHost } = useParty();
  const partyName = party?.name ?? 'the party';
  const blocked = !allowCameras && !isHost;
  return (
    <div className="call-controls">
      <button
        type="button"
        className={`cam-btn ${camOn ? 'on' : ''} ${blocked ? 'blocked' : ''}`}
        onClick={toggleCam}
        aria-pressed={camOn}
        title={blocked ? 'The host has turned off cameras' : 'Your video is shown to the party'}
      >
        {camOn ? <Video size={18} strokeWidth={2} aria-hidden="true" /> : <VideoOff size={18} strokeWidth={2} aria-hidden="true" />}
        <span>{camOn ? 'Camera on' : blocked ? 'Cameras off' : 'Turn on camera'}</span>
      </button>
      <button
        type="button"
        className={`mic-btn ${micOn ? '' : 'off'}`}
        onClick={toggleMic}
        aria-pressed={micOn}
        aria-label={micOn ? 'Mute your mic' : 'Unmute your mic'}
        title={micOn ? 'Mute your mic' : 'Unmute your mic'}
      >
        {micOn ? <Mic size={18} strokeWidth={2} aria-hidden="true" /> : <MicOff size={18} strokeWidth={2} aria-hidden="true" />}
      </button>
      <div className="segmented sm" role="group" aria-label="Where to show cameras">
        {[['strip', 'Strip'], ['pip', 'On video'], ['hide', 'Hide']].map(([id, label]) => (
          <button key={id} type="button" aria-pressed={layout === id} onClick={() => setLayout(id)}>{label}</button>
        ))}
      </div>
      {askConsent && (
        <ConfirmDialog
          title="Turn on your camera?"
          body={`Everyone in ${partyName} will see your video. You can turn it off at any time, and the host can also stop it.`}
          cta="Turn on camera"
          onCancel={cancelConsent}
          onConfirm={confirmCam}
        />
      )}
    </div>
  );
}

// Camera tiles over the match picture ("On video" layout).
export function PipTiles({ people, isHost }) {
  const { media, layout, speaking, tileWidths, setTileWidth } = useCall();
  if (layout !== 'pip') return null;
  const live = people.filter((p) => media[p.userId]?.video);
  if (!live.length) return null;
  const resize = { corner: 'tl', onResize: (w) => setTileWidth('pip', w), onReset: () => setTileWidth('pip', null) };
  return (
    <div className="pip-tiles" role="group" aria-label="Participant cameras" style={{ bottom: isHost ? 100 : 66 }}>
      {live.map((p) => {
        const m = media[p.userId];
        return (
          <CallTile key={p.userId} stream={m.stream} version={m.version} name={p.name} ring={p.ring} self={m.self}
            micOff={!m.mic} speaking={speaking?.has(p.userId)} width={tileWidths.pip} resize={resize} />
        );
      })}
    </div>
  );
}
