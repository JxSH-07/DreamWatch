import { useEffect, useRef, useState } from 'react';

// Returns the set of ids whose audio is currently above a speaking threshold.
// streams: { id: MediaStream | null }. `key` should change when tracks change.
export function useSpeaking(streams, key) {
  const [speaking, setSpeaking] = useState(() => new Set());
  const ctxRef = useRef(null);

  useEffect(() => {
    const entries = Object.entries(streams).filter(([, s]) => s?.getAudioTracks().some((t) => t.readyState === 'live'));
    if (!entries.length) {
      setSpeaking((s) => (s.size ? new Set() : s));
      return undefined;
    }
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return undefined;
    if (!ctxRef.current) ctxRef.current = new Ctx();
    const ctx = ctxRef.current;
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});

    const meters = entries.map(([id, stream]) => {
      const source = ctx.createMediaStreamSource(new MediaStream(stream.getAudioTracks()));
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      return { id, source, analyser, buf: new Uint8Array(analyser.fftSize), hold: 0 };
    });

    const id = setInterval(() => {
      const next = new Set();
      for (const m of meters) {
        m.analyser.getByteTimeDomainData(m.buf);
        let sum = 0;
        for (const v of m.buf) sum += (v - 128) * (v - 128);
        const rms = Math.sqrt(sum / m.buf.length);
        m.hold = rms > 6 ? 4 : Math.max(0, m.hold - 1);
        if (m.hold > 0) next.add(m.id);
      }
      setSpeaking((prev) => (prev.size === next.size && [...next].every((x) => prev.has(x)) ? prev : next));
    }, 150);

    return () => {
      clearInterval(id);
      for (const m of meters) m.source.disconnect();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => () => { ctxRef.current?.close().catch(() => {}); }, []);
  return speaking;
}
