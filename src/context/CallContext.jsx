import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { useAuth } from './AuthContext.jsx';
import { useParty } from './PartyContext.jsx';
import { useToast } from './ToastContext.jsx';
import { useSpeaking } from '../hooks/useSpeaking.js';

/*
  Video calls for a watch party: a WebRTC mesh (every participant connects to every
  other), fine for parties of up to ~6. Signalling runs over a Supabase Realtime
  broadcast channel `call:{partyId}`; presence on that channel says who is in the
  room and whether their camera / mic is on. Media never touches our servers.

  Negotiation uses the "perfect negotiation" pattern, so either side may add or
  remove tracks at any time without glare.
*/

const CallContext = createContext(null);

function iceServers() {
  try {
    const custom = JSON.parse(import.meta.env.VITE_ICE_SERVERS || 'null');
    if (Array.isArray(custom) && custom.length) return custom;
  } catch {
    console.error('VITE_ICE_SERVERS is not valid JSON; using public STUN only');
  }
  return [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];
}

const LAYOUT_KEY = 'dw.callLayout';
const readLayout = () => {
  try { return localStorage.getItem(LAYOUT_KEY) || 'strip'; } catch { return 'strip'; }
};

// Camera tile width per layout (height follows at 5:3), resizable by dragging a tile's corner.
const TILE_KEY = 'dw.camTileWidth';
export const TILE_DEFAULTS = { strip: 120, pip: 112 };
export const TILE_LIMITS = { strip: [96, 400], pip: [84, 340] };
const readTileWidths = () => {
  try { return { ...TILE_DEFAULTS, ...JSON.parse(localStorage.getItem(TILE_KEY) || '{}') }; } catch { return { ...TILE_DEFAULTS }; }
};

export function CallProvider({ active, children }) {
  const { user } = useAuth();
  const { partyId, party, isHost, memberMap, rpc } = useParty();
  const toast = useToast();
  const me = user.id;

  const localStream = useRef(new MediaStream());
  const pcs = useRef(new Map()); // peerId -> { pc, polite, makingOffer, ignoreOffer }
  const channelRef = useRef(null);
  const subscribed = useRef(false);

  const [camOn, setCamOn] = useState(false);
  const [micOn, setMicOn] = useState(false);
  const [localVersion, setLocalVersion] = useState(0);
  const [remote, setRemote] = useState({}); // peerId -> { stream, version }
  const [peerMedia, setPeerMedia] = useState({}); // peerId -> { cam, mic }
  const [layout, setLayoutState] = useState(readLayout);
  const [tileWidths, setTileWidths] = useState(readTileWidths);
  const [consented, setConsented] = useState(false);
  const [askConsent, setAskConsent] = useState(false);

  const allowCameras = party?.settings?.allow_cameras !== false;
  const hostName = memberMap[party?.host_id]?.profile?.display_name ?? 'The host';

  const setLayout = (l) => {
    setLayoutState(l);
    try { localStorage.setItem(LAYOUT_KEY, l); } catch { /* per-viewer convenience only */ }
  };

  // width null = reset to default for that layout.
  const setTileWidth = useCallback((which, width) => {
    setTileWidths((t) => {
      const [min, max] = TILE_LIMITS[which];
      const next = { ...t, [which]: width == null ? TILE_DEFAULTS[which] : Math.round(Math.min(max, Math.max(min, width))) };
      try { localStorage.setItem(TILE_KEY, JSON.stringify(next)); } catch { /* per-viewer convenience only */ }
      return next;
    });
  }, []);

  const send = useCallback((payload) => {
    channelRef.current?.send({ type: 'broadcast', event: 'signal', payload: { ...payload, from: me } });
  }, [me]);

  const bumpRemote = useCallback((peerId, stream) => {
    setRemote((r) => ({ ...r, [peerId]: { stream: stream ?? r[peerId]?.stream, version: (r[peerId]?.version ?? 0) + 1 } }));
  }, []);

  const closePeer = useCallback((peerId) => {
    const entry = pcs.current.get(peerId);
    if (entry) {
      entry.pc.close();
      pcs.current.delete(peerId);
    }
    setRemote((r) => {
      if (!r[peerId]) return r;
      const next = { ...r };
      delete next[peerId];
      return next;
    });
  }, []);

  const getPeer = useCallback((peerId) => {
    const existing = pcs.current.get(peerId);
    if (existing) return existing;
    const pc = new RTCPeerConnection({ iceServers: iceServers() });
    const entry = { pc, polite: me > peerId, makingOffer: false, ignoreOffer: false, senders: {} };
    pcs.current.set(peerId, entry);

    for (const track of localStream.current.getTracks()) {
      entry.senders[track.kind] = pc.addTrack(track, localStream.current);
    }

    pc.onnegotiationneeded = async () => {
      try {
        entry.makingOffer = true;
        await pc.setLocalDescription();
        send({ to: peerId, description: pc.localDescription });
      } catch (err) {
        console.error('negotiation failed', err);
      } finally {
        entry.makingOffer = false;
      }
    };
    pc.onicecandidate = ({ candidate }) => {
      if (candidate) send({ to: peerId, candidate });
    };
    pc.ontrack = ({ track, streams }) => {
      const stream = streams[0] ?? new MediaStream([track]);
      bumpRemote(peerId, stream);
      track.onunmute = () => bumpRemote(peerId);
      track.onmute = () => bumpRemote(peerId);
      track.onended = () => bumpRemote(peerId);
      stream.onremovetrack = () => bumpRemote(peerId);
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed') pc.restartIce();
    };
    return entry;
  }, [me, send, bumpRemote]);

  const onSignal = useCallback(async ({ from, to, description, candidate, kind }) => {
    if (to !== me || from === me) return;
    if (kind === 'stop_video') {
      if (from !== party?.host_id) return;
      stopCamera();
      toast(`${hostName} turned off your camera`, 'warn');
      return;
    }
    if (kind === 'ask_video') {
      if (from !== party?.host_id) return;
      toast(`${hostName} asked you to turn on your camera`);
      return;
    }
    const entry = getPeer(from);
    const { pc } = entry;
    try {
      if (description) {
        const collision = description.type === 'offer' && (entry.makingOffer || pc.signalingState !== 'stable');
        entry.ignoreOffer = !entry.polite && collision;
        if (entry.ignoreOffer) return;
        await pc.setRemoteDescription(description);
        if (description.type === 'offer') {
          await pc.setLocalDescription();
          send({ to: from, description: pc.localDescription });
        }
      } else if (candidate) {
        try {
          await pc.addIceCandidate(candidate);
        } catch (err) {
          if (!entry.ignoreOffer) throw err;
        }
      }
    } catch (err) {
      console.error('signal handling failed', err);
    }
  // stopCamera is stable for our purposes (reads refs); listing it would re-subscribe the channel.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me, getPeer, send, party?.host_id, hostName, toast]);

  const onSignalRef = useRef(onSignal);
  onSignalRef.current = onSignal;

  // ---------- Channel: signalling + presence ----------
  useEffect(() => {
    if (!active) return undefined;
    const ch = supabase.channel(`call:${partyId}`, { config: { presence: { key: me }, broadcast: { self: false } } });
    ch
      .on('broadcast', { event: 'signal' }, ({ payload }) => onSignalRef.current(payload))
      .on('presence', { event: 'sync' }, () => {
        const state = ch.presenceState();
        const media = {};
        for (const [key, metas] of Object.entries(state)) {
          if (key === me) continue;
          const last = metas[metas.length - 1] ?? {};
          media[key] = { cam: !!last.cam, mic: !!last.mic };
        }
        setPeerMedia(media);
        for (const peerId of Object.keys(media)) getPeer(peerId);
        for (const peerId of [...pcs.current.keys()]) if (!media[peerId]) closePeer(peerId);
      })
      .subscribe((status) => {
        subscribed.current = status === 'SUBSCRIBED';
        if (subscribed.current) ch.track({ cam: false, mic: false });
      });
    channelRef.current = ch;
    const peers = pcs.current;
    const local = localStream.current;
    return () => {
      subscribed.current = false;
      channelRef.current = null;
      for (const peerId of [...peers.keys()]) closePeer(peerId);
      for (const t of local.getTracks()) { t.stop(); local.removeTrack(t); }
      setCamOn(false);
      setMicOn(false);
      supabase.removeChannel(ch);
    };
  }, [active, partyId, me, getPeer, closePeer]);

  // Keep our presence in step with our media.
  useEffect(() => {
    if (subscribed.current) channelRef.current?.track({ cam: camOn, mic: micOn });
  }, [camOn, micOn]);

  // ---------- Local media ----------
  // Each peer connection keeps one sender per kind. Turning media off swaps in a null
  // track and back on swaps the new track in, so toggling needs no renegotiation and
  // the remote side keeps a single track per kind.
  const addLocalTrack = (track) => {
    localStream.current.addTrack(track);
    for (const entry of pcs.current.values()) {
      const sender = entry.senders[track.kind];
      if (sender) sender.replaceTrack(track).catch((err) => console.error('replaceTrack failed', err));
      else entry.senders[track.kind] = entry.pc.addTrack(track, localStream.current);
    }
    setLocalVersion((v) => v + 1);
  };
  const removeLocalTracks = (kind) => {
    for (const entry of pcs.current.values()) entry.senders[kind]?.replaceTrack(null).catch(() => {});
    for (const track of localStream.current.getTracks().filter((t) => t.kind === kind)) {
      track.stop();
      localStream.current.removeTrack(track);
    }
    setLocalVersion((v) => v + 1);
  };

  function stopCamera() {
    removeLocalTracks('video');
    setCamOn(false);
  }

  const mediaError = (err, what) => {
    console.error(`${what} failed`, err);
    toast(err?.name === 'NotAllowedError'
      ? `Your browser blocked the ${what} — allow it in the address bar and try again`
      : `Couldn't start your ${what}`, 'warn');
  };

  const startCamera = async () => {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 640 }, height: { ideal: 360 }, frameRate: { ideal: 24 } } });
      const track = s.getVideoTracks()[0];
      track.onended = () => { removeLocalTracks('video'); setCamOn(false); };
      addLocalTrack(track);
      setCamOn(true);
      toast('Your camera is on');
    } catch (err) {
      mediaError(err, 'camera');
    }
  };

  const toggleCam = () => {
    if (camOn) { stopCamera(); toast('Your camera is off'); return; }
    if (!allowCameras && !isHost) { toast('The host has turned off cameras for this party', 'warn'); return; }
    if (!consented) { setAskConsent(true); return; }
    startCamera();
  };
  const confirmCam = () => {
    setAskConsent(false);
    setConsented(true);
    startCamera();
  };

  const toggleMic = async () => {
    if (micOn) {
      removeLocalTracks('audio');
      setMicOn(false);
      return;
    }
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      addLocalTrack(s.getAudioTracks()[0]);
      setMicOn(true);
    } catch (err) {
      mediaError(err, 'microphone');
    }
  };

  // Guests' cameras stop when the host turns cameras off for the party.
  useEffect(() => {
    if (!allowCameras && !isHost && camOn) {
      stopCamera();
      toast(`${hostName} turned off guest cameras`, 'warn');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allowCameras, isHost, camOn]);

  // ---------- Host actions ----------
  const hostStopVideo = (userId) => {
    send({ to: userId, kind: 'stop_video' });
    const name = memberMap[userId]?.profile?.display_name ?? 'Their';
    rpc('post_system_message', { p_party: partyId, p_body: `${hostName} stopped ${name}'s video` });
    toast(`${name}'s video is off`);
  };
  const hostAskVideo = (userId) => {
    send({ to: userId, kind: 'ask_video' });
    toast(`Asked ${memberMap[userId]?.profile?.display_name ?? 'them'} to turn on their camera`);
  };

  // ---------- Derived ----------
  const localView = useMemo(
    () => (camOn ? new MediaStream(localStream.current.getVideoTracks()) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [camOn, localVersion],
  );

  // userId -> { stream, video: bool, mic: bool, self: bool }
  const media = useMemo(() => {
    const out = { [me]: { stream: localView, video: camOn && !!localView, mic: micOn, self: true, version: localVersion } };
    for (const [peerId, m] of Object.entries(peerMedia)) {
      const r = remote[peerId];
      const liveVideo = !!r?.stream?.getVideoTracks().some((t) => t.readyState === 'live' && !t.muted);
      out[peerId] = { stream: r?.stream ?? null, video: m.cam && liveVideo, mic: m.mic, self: false, version: r?.version ?? 0 };
    }
    return out;
  }, [me, localView, camOn, micOn, localVersion, peerMedia, remote]);

  const audioStreams = useMemo(() => {
    const out = {};
    if (micOn) out[me] = localStream.current;
    for (const [peerId, r] of Object.entries(remote)) if (peerMedia[peerId]?.mic && r.stream) out[peerId] = r.stream;
    return out;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me, micOn, localVersion, remote, peerMedia]);
  const audioKey = Object.entries(audioStreams)
    .map(([id, s]) => `${id}:${s.getAudioTracks().map((t) => t.id).join(',')}`).join('|');
  const speaking = useSpeaking(audioStreams, audioKey);

  const value = {
    camOn, micOn, toggleCam, toggleMic, layout, setLayout, tileWidths, setTileWidth, media, allowCameras, speaking,
    askConsent, confirmCam, cancelConsent: () => setAskConsent(false), hostStopVideo, hostAskVideo,
  };
  return <CallContext.Provider value={value}>{children}</CallContext.Provider>;
}

export const useCall = () => useContext(CallContext);
