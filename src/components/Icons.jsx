// Brand and football icons from the design export. Generic UI icons come from lucide-react.
import {
  ArrowUpDown, Activity, CornerDownRight, Crosshair, Flag, Goal as GoalNet, Hand, RectangleVertical, Shuffle, Target, Timer,
  TriangleAlert, Tv,
} from 'lucide-react';

export function LogoMark({ size = 30, ring = '#0A0D16' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <circle cx="31" cy="33" r="27" fill="#B6FF3B" />
      <path d="M25 22 42 33 25 44z" fill="#07090F" stroke="#07090F" strokeWidth="4" strokeLinejoin="round" />
      <path d="M25 22 19 9M42 33l15-2M25 44l-5 13" stroke="#07090F" strokeWidth="3.5" strokeLinecap="round" />
      <path d="M54 2l2.2 5.8L62 10l-5.8 2.2L54 18l-2.2-5.8L46 10l5.8-2.2z" fill="#EEF2F8" stroke={ring} strokeWidth="2.5" paintOrder="stroke" />
    </svg>
  );
}

export function Wordmark({ className = '' }) {
  return (
    <span className={`logo-word ${className}`}>
      <span>DREAM</span> <span className="w2">WATCH</span>
    </span>
  );
}

export function BallIcon({ size = 17 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7.5l4 2.9-1.5 4.6h-5L8 10.4z" />
      <path d="M12 3v4.5M16 10.4l4.3-1.4M14.5 15l2.6 3.7M9.5 15l-2.6 3.7M8 10.4 3.7 9" />
    </svg>
  );
}

export function WhistleIcon({ size = 17, strokeWidth = 2.2 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="9" cy="14" r="5.5" />
      <path d="M12.5 10 21 6v4.5l-5.5 2.8" />
      <circle cx="9" cy="14" r="1.2" fill="currentColor" />
    </svg>
  );
}

// Gaffer's tactics-board avatar.
export function GafferIcon({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
      <rect x="3" y="3" width="18" height="18" rx="3" />
      <path d="M7 7l3 3M10 7l-3 3" />
      <circle cx="16.5" cy="16.5" r="2" />
      <path d="M8.5 14.5c1.5 2.5 3.5 3 5.5 2.2" strokeDasharray="1.5 2" />
    </svg>
  );
}

export function GafferAvatar({ size = 'md' }) {
  const px = size === 'xs' ? 14 : size === 'sm' ? 15 : 18;
  return (
    <span className={`gaffer-avatar ${size === 'md' ? '' : size}`}>
      <GafferIcon size={px} />
    </span>
  );
}

const ICONS = {
  goal: BallIcon,
  pen: GoalNet,
  var: Tv,
  sub: ArrowUpDown,
  offside: Flag,
  hand: Hand,
  foul: TriangleAlert,
  shot: Crosshair,
  tactic: Shuffle,
  injury: Activity,
  shootout: Target,
  corner: CornerDownRight,
  added: Timer,
  yellow: RectangleVertical,
  red: RectangleVertical,
};

export function EventIcon({ kind, size = 17 }) {
  if (kind === 'whistle') return <WhistleIcon size={size} />;
  if (kind === 'goal') return <BallIcon size={size} />;
  const Cmp = ICONS[kind] ?? Activity;
  const filled = kind === 'yellow' || kind === 'red';
  return <Cmp size={size} strokeWidth={2.2} fill={filled ? 'currentColor' : 'none'} aria-hidden="true" />;
}
