export const NEUTRAL = { name: 'Neutral', short: 'NEU', color: '#A3ABBD', text: '#C3C9D6' };

export function teamInfo(config, name) {
  const t = name && config?.teams?.[name];
  if (!t) return NEUTRAL;
  return { name, short: t.short, color: t.color, text: t.text ?? t.color };
}

export function initial(name) {
  return (String(name || '?').trim().charAt(0) || '?').toUpperCase();
}

export function shortName(player) {
  if (!player) return '';
  const parts = player.trim().split(/\s+/);
  return parts.length > 1 ? parts.slice(-1)[0] : player;
}

export function cardColor(e) {
  const hay = `${e.data?.card ?? ''} ${e.description}`;
  if (/second yellow/i.test(hay)) return 'second';
  return /\bred card\b/i.test(hay) ? 'red' : 'yellow';
}

// Title, icon kind and optional player banner for a match event.
export function eventMeta(e, config) {
  const scoreline = e.score_after ? `${e.score_after[config.home]}–${e.score_after[config.away]}` : '';
  switch (e.type) {
    case 'goal':
      return { title: 'Goal', icon: 'goal', banner: `GOAL · ${shortName(e.player).toUpperCase()}${scoreline ? ` · ${scoreline}` : ''}`, bannerBg: '#B6FF3B' };
    case 'card': {
      const c = cardColor(e);
      const title = c === 'red' ? 'Red card' : c === 'second' ? 'Second yellow' : 'Yellow card';
      return { title, icon: c === 'yellow' ? 'yellow' : 'red', banner: `${title.toUpperCase()} · ${shortName(e.player).toUpperCase()}`, bannerBg: c === 'yellow' ? '#F6D234' : '#FF6B73' };
    }
    case 'penalty_awarded':
      return { title: 'Penalty awarded', icon: 'pen', banner: `PENALTY · ${(e.team ? config.teams?.[e.team]?.short ?? e.team : '').toUpperCase()}`, bannerBg: '#FFB020' };
    case 'penalty_missed':
      return { title: 'Penalty missed', icon: 'pen', banner: `PENALTY MISSED · ${shortName(e.player).toUpperCase()}`, bannerBg: '#FFB020' };
    case 'var_decision':
      return { title: 'VAR decision', icon: 'var', banner: 'VAR CHECK', bannerBg: '#FFB020' };
    case 'substitution': return { title: 'Substitution', icon: 'sub' };
    case 'corner': return { title: 'Corner', icon: 'corner' };
    case 'added_time': return { title: `${e.data?.minutes ?? ''} min added time`.trim(), icon: 'added' };
    case 'offside': return { title: 'Offside', icon: 'offside' };
    case 'handball': return { title: 'Handball', icon: 'hand' };
    case 'foul': return { title: 'Foul', icon: 'foul' };
    case 'shot': return { title: 'Shot', icon: 'shot' };
    case 'tactical_shift': return { title: 'Tactical change', icon: 'tactic' };
    case 'injury': return { title: 'Injury', icon: 'injury' };
    case 'shootout_kick': {
      const scored = /scores/i.test(e.description);
      return { title: scored ? 'Penalty scored' : 'Penalty missed', icon: 'shootout' };
    }
    case 'period_start': return { title: e.period === 1 ? 'Kick-off' : e.period === 5 ? 'Shootout begins' : `${e.period_label ?? 'Period'} begins`, icon: 'whistle' };
    case 'period_end': return { title: `End of ${e.period_label ?? 'period'}`, icon: 'whistle' };
    default: return { title: e.type, icon: 'whistle' };
  }
}

export function aboutChip(e, config) {
  if (!e) return '';
  return `${e.clock ?? ''} ${eventMeta(e, config).title}${e.player ? ` · ${shortName(e.player)}` : ''}`.trim();
}

export function timeOfDay(iso) {
  const d = iso ? new Date(iso) : new Date();
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}

export function fmtDuration(seconds) {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${String(m).padStart(2, '0')}:${ss}`;
}

export const inviteLink = (partyId) => `${window.location.origin}/invite/${partyId}`;

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
