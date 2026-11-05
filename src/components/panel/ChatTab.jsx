import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, BookOpen, ChevronRight, Clock, Flag, Paperclip, Reply, Send, ShieldAlert, X } from 'lucide-react';
import { useAuth } from '../../context/AuthContext.jsx';
import { useParty } from '../../context/PartyContext.jsx';
import { aboutChip, teamInfo, timeOfDay } from '../../lib/format.js';
import { GafferAvatar } from '../Icons.jsx';
import { Avatar } from '../ui.jsx';

export function memberLook(member, config) {
  const name = member?.profile?.display_name ?? 'Someone';
  const team = member?.team_supported ? teamInfo(config, member.team_supported) : null;
  return {
    name,
    ring: team && team.name !== 'Neutral' ? team.color : member?.profile?.avatar_color ?? 'var(--line-3)',
    nameColor: team && team.name !== 'Neutral' ? team.text : 'var(--text)',
  };
}

const mentionToken = (name) => `@${String(name).replace(/\s+/g, '')}`;

function MessageText({ text, members }) {
  const names = new Set(members.map((m) => mentionToken(m.profile?.display_name ?? '').toLowerCase()));
  const parts = text.split(/(@[\w.-]+)/g).filter(Boolean);
  return (
    <p className="text">
      {parts.map((p, i) => {
        if (/^@gaffer$/i.test(p)) return <span key={i} className="mention">{p}</span>;
        if (p.startsWith('@') && names.has(p.toLowerCase())) return <span key={i} className="mention user">{p}</span>;
        return <span key={i}>{p}</span>;
      })}
    </p>
  );
}

const SOURCE = {
  data: 'From match data',
  likely: 'Likely explanation',
  general: 'General rule',
};

export default function ChatTab({ match, events, position, composer, setComposer, onAboutClick, onPollsClick, focusKey }) {
  const { user } = useAuth();
  const { messages, members, memberMap, me, isHost, thinking, typing, sendMessage, sendTyping, rpc } = useParty();
  const config = match.config;
  const logRef = useRef(null);
  const inputRef = useRef(null);
  const [atBottom, setAtBottom] = useState(true);
  const [unseen, setUnseen] = useState(0);
  const [revealed, setRevealed] = useState(() => new Set());
  const lastTyping = useRef(0);
  const eventById = useMemo(() => Object.fromEntries(events.map((e) => [e.id, e])), [events]);
  const byId = useMemo(() => Object.fromEntries(messages.map((m) => [m.id, m])), [messages]);
  const live = match.mode === 'live';

  // Auto-scroll unless the reader has scrolled up.
  useLayoutEffect(() => {
    const el = logRef.current;
    if (!el) return;
    if (atBottom) el.scrollTop = el.scrollHeight;
    else setUnseen((n) => n + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages.length, Object.keys(thinking).length]);

  useEffect(() => {
    if (focusKey) inputRef.current?.focus();
  }, [focusKey]);

  const onScroll = () => {
    const el = logRef.current;
    const bottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    setAtBottom(bottom);
    if (bottom) setUnseen(0);
  };
  const toBottom = () => {
    logRef.current.scrollTop = logRef.current.scrollHeight;
    setUnseen(0);
    setAtBottom(true);
  };

  // ---------- Composer ----------
  const draft = composer.draft;
  const mentionQuery = /(?:^|\s)@([\w.-]*)$/.exec(draft)?.[1];
  const mentionOptions = useMemo(() => {
    if (mentionQuery == null) return [];
    const q = mentionQuery.toLowerCase();
    const opts = [];
    if ('gaffer'.startsWith(q)) opts.push({ token: '@Gaffer', gaffer: true });
    members
      .filter((m) => m.status === 'joined' && m.user_id !== user.id)
      .map((m) => mentionToken(m.profile?.display_name ?? ''))
      .filter((t) => t.length > 1 && t.slice(1).toLowerCase().startsWith(q))
      .slice(0, 4)
      .forEach((t) => opts.push({ token: t }));
    return opts;
  }, [mentionQuery, members, user.id]);

  const complete = (token) => {
    setComposer((c) => ({ ...c, draft: c.draft.replace(/@([\w.-]*)$/, `${token} `) }));
    inputRef.current?.focus();
  };

  const asking = /@gaffer\b/i.test(draft);
  const attached = composer.eventId ? eventById[composer.eventId] : null;
  const replying = composer.replyTo ? byId[composer.replyTo] : null;
  const muted = !!me?.muted;

  const submit = async (e) => {
    e?.preventDefault();
    if (!draft.trim() || muted) return;
    const payload = { body: draft, eventId: composer.eventId, replyTo: composer.replyTo, videoTime: Math.round(position * 10) / 10 };
    setComposer({ draft: '', eventId: null, replyTo: null });
    toBottom();
    const ok = await sendMessage(payload);
    if (!ok) setComposer((c) => ({ ...c, draft: payload.body }));
  };

  const onKeyDown = (e) => {
    if (e.key === 'Tab' && mentionOptions.length) {
      e.preventDefault();
      complete(mentionOptions[0].token);
    } else if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  };
  const onChange = (e) => {
    setComposer((c) => ({ ...c, draft: e.target.value.slice(0, 1000) }));
    if (Date.now() - lastTyping.current > 1500) {
      lastTyping.current = Date.now();
      sendTyping();
    }
  };

  const typers = Object.keys(typing).filter((id) => id !== user.id).map((id) => memberMap[id]?.profile?.display_name).filter(Boolean);
  const pendingGaffer = Object.entries(thinking);

  return (
    <>
      <div className="chat-log scroll" role="log" aria-label="Party chat" ref={logRef} onScroll={onScroll}>
        <div className="chat-list">
          {messages.map((m) => {
            if (m.author_type === 'system') {
              return (
                <div key={m.id} className="msg-system rise-in">
                  <Clock size={12} strokeWidth={2.2} aria-hidden="true" /><span>{m.body}</span>
                </div>
              );
            }
            if (m.author_type === 'gaffer') {
              const asker = m.reply_to ? byId[m.reply_to] : null;
              const askerName = asker ? memberMap[asker.user_id]?.profile?.display_name : null;
              const about = m.meta?.about_event_id ? eventById[m.meta.about_event_id] : null;
              return (
                <article key={m.id} className="gaffer-card rise-in" aria-label="Gaffer, AI match companion">
                  <div className="gaffer-head">
                    <GafferAvatar />
                    <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.15 }}>
                      <span className="gaffer-name">Gaffer</span>
                      <span className="gaffer-role">AI match companion{askerName ? ` · replying to ${askerName}` : ''}</span>
                    </div>
                    <span className="tab-num" style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--dim)' }}>{timeOfDay(m.created_at)}</span>
                  </div>
                  {(m.meta?.about_label || about) && (
                    <button type="button" className="gaffer-about" onClick={() => onAboutClick(m.meta.about_event_id)}>
                      <Clock size={12} strokeWidth={2.4} aria-hidden="true" />
                      <span>About: {about ? aboutChip(about, config) : m.meta.about_label}</span>
                      <ChevronRight size={11} strokeWidth={2.6} aria-hidden="true" />
                    </button>
                  )}
                  <p className="gaffer-text">{m.body}</p>
                  {m.meta?.kind === 'poll' && (
                    <button type="button" className="gaffer-about" onClick={onPollsClick}>Open Polls<ChevronRight size={11} strokeWidth={2.6} aria-hidden="true" /></button>
                  )}
                  {(m.meta?.rule || m.meta?.confidence) && (
                    <div className="gaffer-foot">
                      {m.meta.rule && <span className="rule-chip"><BookOpen size={12} strokeWidth={2.2} aria-hidden="true" />{m.meta.rule}</span>}
                      {m.meta.confidence && <span className={`src-chip ${m.meta.confidence}`}>{SOURCE[m.meta.confidence] ?? m.meta.confidence}</span>}
                    </div>
                  )}
                </article>
              );
            }

            const author = memberMap[m.user_id];
            const look = memberLook(author, config);
            if (m.flagged && !(isHost && revealed.has(m.id))) {
              return (
                <div key={m.id} className="msg-mod">
                  <ShieldAlert size={16} strokeWidth={2} aria-hidden="true" />
                  <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <div className="t">
                      Message hidden by moderation
                      {isHost && (
                        <> · <button type="button" className="btn-link" style={{ fontSize: 13 }} onClick={() => setRevealed((r) => new Set(r).add(m.id))}>Show anyway</button></>
                      )}
                    </div>
                    {isHost && <span className="n">Only the host can see this · {m.flag_reason ?? 'Flagged'}</span>}
                  </div>
                </div>
              );
            }
            if (m.flagged) {
              return (
                <div key={m.id} className="msg-mod">
                  <ShieldAlert size={16} strokeWidth={2} aria-hidden="true" />
                  <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <div className="t" style={{ color: 'var(--text-2)' }}><span style={{ fontWeight: 600, color: look.nameColor }}>{look.name}</span> · {m.body}</div>
                    <div style={{ display: 'flex', gap: 12 }}>
                      <button type="button" className="btn-link" onClick={() => rpc('unflag_message', { p_message: m.id }, "Couldn't restore that message")}>Restore for everyone</button>
                      <button type="button" className="btn-link" style={{ color: 'var(--muted-3)' }} onClick={() => setRevealed((r) => { const n = new Set(r); n.delete(m.id); return n; })}>Hide again</button>
                    </div>
                    <span className="n">Only the host can see this · {m.flag_reason ?? 'Flagged'}</span>
                  </div>
                </div>
              );
            }
            const quoted = m.reply_to ? byId[m.reply_to] : null;
            const ev = m.event_id ? eventById[m.event_id] : null;
            return (
              <div key={m.id} className={`msg ${m.pending ? 'pending' : ''}`}>
                <Avatar name={look.name} ring={look.ring} size={32} />
                <div className="body">
                  <div className="head">
                    <span className="name" style={{ color: look.nameColor }}>{look.name}</span>
                    <span className="time">{timeOfDay(m.created_at)}</span>
                  </div>
                  {quoted && <span className="reply-quote">{memberMap[quoted.user_id]?.profile?.display_name ?? (quoted.author_type === 'gaffer' ? 'Gaffer' : '')}: {quoted.flagged ? 'hidden message' : quoted.body}</span>}
                  {ev && <span className="ctx-chip">Re: {aboutChip(ev, config)}</span>}
                  <MessageText text={m.body} members={members} />
                </div>
                {!m.pending && (
                  <div className="msg-actions">
                    <button type="button" aria-label={`Reply to ${look.name}`} title="Reply" onClick={() => { setComposer((c) => ({ ...c, replyTo: m.id })); inputRef.current?.focus(); }}>
                      <Reply size={14} strokeWidth={2} aria-hidden="true" />
                    </button>
                    {m.user_id !== user.id && (
                      <button type="button" className="flag" aria-label={`Report message from ${look.name}`} title="Report message" onClick={() => rpc('report_message', { p_message: m.id }, "Couldn't report that message")}>
                        <Flag size={14} strokeWidth={2} aria-hidden="true" />
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}

          {pendingGaffer.map(([id, t]) => (
            <div key={id} className={`thinking rise-in ${t.failed ? 'failed' : ''}`} role="status">
              <GafferAvatar size="sm" />
              {t.failed ? (
                <span className="t">Gaffer couldn't answer that one — try again</span>
              ) : (
                <>
                  <span className="t">Gaffer is analysing</span>
                  <span className="dots" aria-hidden="true"><span /><span /><span /></span>
                </>
              )}
            </div>
          ))}
        </div>
        {!atBottom && unseen > 0 && (
          <button type="button" className="new-msgs" onClick={toBottom}>New messages <ArrowDown size={13} strokeWidth={2.6} aria-hidden="true" /></button>
        )}
      </div>

      <div className="composer">
        {mentionOptions.length > 0 && (
          <div className="mention-menu" role="listbox" aria-label="Mention">
            {mentionOptions.map((o, i) => (
              <button key={o.token} type="button" role="option" aria-selected={i === 0} className={`mention-opt ${o.gaffer ? 'gaffer' : ''}`} onClick={() => complete(o.token)}>
                {o.gaffer ? <GafferAvatar size="xs" /> : <Avatar name={o.token.slice(1)} size={24} />}
                <span className="n">{o.token}</span>
                {o.gaffer && <span className="s">AI match expert</span>}
                {i === 0 && <span className="k">Tab</span>}
              </button>
            ))}
          </div>
        )}
        {attached && (
          <div className="attach-chip">
            <Paperclip size={12} strokeWidth={2.2} aria-hidden="true" style={{ color: 'var(--muted-2)' }} />
            <span className="l">Attached</span>
            <span className="v">{aboutChip(attached, config)}</span>
            <button type="button" aria-label="Remove attached event" onClick={() => setComposer((c) => ({ ...c, eventId: null }))}><X size={12} strokeWidth={2.6} /></button>
          </div>
        )}
        {replying && (
          <div className="attach-chip">
            <Reply size={12} strokeWidth={2.2} aria-hidden="true" style={{ color: 'var(--muted-2)' }} />
            <span className="l">Replying to</span>
            <span className="v">{memberMap[replying.user_id]?.profile?.display_name ?? 'Gaffer'}</span>
            <button type="button" aria-label="Cancel reply" onClick={() => setComposer((c) => ({ ...c, replyTo: null }))}><X size={12} strokeWidth={2.6} /></button>
          </div>
        )}
        <form className="composer-form" onSubmit={submit}>
          <label htmlFor="chat-input" className="sr-only">Message the party</label>
          <div className={`composer-box ${asking ? 'asking' : ''}`}>
            {asking && <span className="asking-tag">ASKING GAFFER</span>}
            <textarea
              id="chat-input"
              ref={inputRef}
              rows={1}
              value={draft}
              onChange={onChange}
              onKeyDown={onKeyDown}
              disabled={muted}
              maxLength={1000}
              placeholder={muted ? 'The host has muted you in chat' : 'Message the party or ask @Gaffer'}
            />
          </div>
          <button type="submit" className="send-btn" aria-label="Send message" disabled={!draft.trim() || muted}>
            <Send size={18} strokeWidth={2.4} aria-hidden="true" />
          </button>
        </form>
        <span className="typing" aria-live="polite">
          {typers.length ? `${typers.slice(0, 2).join(', ')} ${typers.length > 1 ? 'are' : 'is'} typing…`
            : live ? 'Type @Gaffer to ask the AI what just happened' : "Type @Gaffer to ask about the replay. Gaffer won't spoil what's ahead"}
        </span>
      </div>
    </>
  );
}
