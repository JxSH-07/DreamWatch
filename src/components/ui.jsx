import { initial } from '../lib/format.js';

export function Avatar({ name, ring, size = 40, online, dim, className = '', children }) {
  const border = size <= 30 ? 2 : 3;
  return (
    <span
      className={`avatar ${className}`}
      aria-hidden="true"
      style={{ width: size, height: size, borderColor: ring ?? 'var(--line-3)', borderWidth: border, fontSize: Math.round(size * 0.38), opacity: dim ? 0.5 : 1 }}
    >
      {initial(name)}
      {online && <span className="online-dot" />}
      {children}
    </span>
  );
}

export function LiveBadge({ small }) {
  return (
    <span className={`badge-live ${small ? 'sm' : ''}`}>
      <span className="live-dot" />LIVE
    </span>
  );
}

export function ModeBadge({ mode, small }) {
  return mode === 'live' ? <LiveBadge small={small} /> : <span className="badge-ft">FULL TIME</span>;
}

// Real flags for national teams in the hero; coloured initials for clubs (no crest assets).
export function TeamMark({ team, config, size = 'lg' }) {
  const lg = size === 'lg';
  const w = lg ? 84 : 44;
  const h = lg ? 56 : 30;
  if (team === 'Argentina') {
    return (
      <svg className="flag" width={w} height={h} viewBox="0 0 30 20" role="img" aria-label="Flag of Argentina">
        <rect width="30" height="20" fill="#74ACDF" />
        <rect y="6.67" width="30" height="6.67" fill="#FFFFFF" />
        <circle cx="15" cy="10" r="2" fill="#F6B40E" />
      </svg>
    );
  }
  if (team === 'France') {
    return (
      <svg className="flag" width={w} height={h} viewBox="0 0 30 20" role="img" aria-label="Flag of France">
        <rect width="10" height="20" fill="#0055A4" />
        <rect x="10" width="10" height="20" fill="#FFFFFF" />
        <rect x="20" width="10" height="20" fill="#EF4135" />
      </svg>
    );
  }
  const t = config?.teams?.[team];
  const px = lg ? 56 : 34;
  return (
    <span
      className="team-mark"
      aria-hidden="true"
      style={{ width: px, height: px, borderRadius: lg ? 14 : 9, background: t?.color ?? '#2A3450', color: '#06120B', fontSize: lg ? 20 : 13 }}
    >
      {t?.short ?? initial(team)}
    </span>
  );
}

export function Switch({ checked, onChange, labelledBy, disabled }) {
  return (
    <button
      type="button"
      role="switch"
      className="switch"
      aria-checked={checked}
      aria-labelledby={labelledBy}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    />
  );
}

export function Loader({ label = 'Loading…' }) {
  return (
    <div className="loader" role="status">
      <svg className="spin" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true">
        <path d="M21 12a9 9 0 1 1-3-6.7" />
      </svg>
      {label}
    </div>
  );
}

export function Spinner({ size = 14 }) {
  return (
    <svg className="spin" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true">
      <path d="M21 12a9 9 0 1 1-3-6.7" />
    </svg>
  );
}

export function ConfirmDialog({ title, body, cta, danger, onCancel, onConfirm }) {
  return (
    <div className="overlay" onClick={onCancel}>
      <div className="dialog sm" role="dialog" aria-modal="true" aria-labelledby="confirm-t" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-body" style={{ gap: 12, paddingTop: 22 }}>
          <h2 id="confirm-t" style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>{title}</h2>
          <p style={{ margin: 0, fontSize: 14, lineHeight: 1.5, color: 'var(--muted)' }}>{body}</p>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 6 }}>
            <button type="button" className="btn btn-ghost" onClick={onCancel}>Cancel</button>
            <button type="button" className={`btn ${danger ? 'btn-danger-solid' : 'btn-primary'}`} onClick={onConfirm} autoFocus>{cta}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// Lime pitch background used behind match summaries.
export function PitchCard({ children, style, padding = 22, label = 'Match' }) {
  return (
    <section className="pitch-card" aria-label={label} style={{ padding, ...style }}>
      <div className="stripes" aria-hidden="true" />
      <div className="shade" aria-hidden="true" />
      <div className="content">{children}</div>
    </section>
  );
}
