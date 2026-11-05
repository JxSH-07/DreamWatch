import { useEffect, useRef } from 'react';
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

// A participant's camera tile. Audio plays through <CallAudio>, so video is always muted here.
export function CallTile({ stream, version, name, ring, self, micOff, speaking, width = 120, height = 72, label }) {
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
      role="img"
      aria-label={label ?? `${self ? 'Your' : `${name}'s`} camera${micOff ? ', mic off' : ''}`}
      style={{ width, height, borderColor: ring, background: `linear-gradient(160deg, ${tint(ring, 0.38)} 0%, #101727 75%)` }}
    >
      <video ref={ref} autoPlay playsInline muted className={self ? 'mirror' : ''} />
      {!stream && <span className="cam-init" aria-hidden="true">{initial(name)}</span>}
      <span className="cam-name">{self ? 'You' : name}</span>
      {micOff && (
        <span className="cam-mic-off" title="Mic off"><MicOff size={9} strokeWidth={3} aria-hidden="true" /></span>
      )}
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
  const { media, layout, speaking } = useCall();
  if (layout !== 'pip') return null;
  const live = people.filter((p) => media[p.userId]?.video);
  if (!live.length) return null;
  return (
    <div className="pip-tiles" role="group" aria-label="Participant cameras" style={{ bottom: isHost ? 100 : 66 }}>
      {live.map((p) => {
        const m = media[p.userId];
        return (
          <CallTile key={p.userId} stream={m.stream} version={m.version} name={p.name} ring={p.ring} self={m.self}
            micOff={!m.mic} speaking={speaking?.has(p.userId)} width={112} height={66} />
        );
      })}
    </div>
  );
}
