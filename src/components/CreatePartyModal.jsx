import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Check, X } from 'lucide-react';
import { supabase } from '../lib/supabase.js';
import { copyText, inviteLink } from '../lib/format.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { ModeBadge, Spinner, Switch } from './ui.jsx';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SUB_TEXT = {
  checking: 'Verifying subscription',
  subscribed: 'Will be invited',
  not_subscribed: "Not subscribed yet — share the invite link; they'll be asked to subscribe when they open it",
  no_account: 'No Dream Watch account yet — share the invite link; they can sign up from it',
  error: "Couldn't check this email",
};

export default function CreatePartyModal({ match, onClose }) {
  const { profile, user } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const config = match.config;
  const partyId = useMemo(() => crypto.randomUUID(), []);
  const [name, setName] = useState(`${profile?.display_name ?? 'My'}'s ${config.home} v ${config.away} party`);
  const [email, setEmail] = useState('');
  const [err, setErr] = useState('');
  const [invites, setInvites] = useState([]);
  const [aiMod, setAiMod] = useState(true);
  const [creating, setCreating] = useState(false);

  const setStatus = (addr, status) => setInvites((list) => list.map((i) => (i.email === addr ? { ...i, status } : i)));

  const add = async (e) => {
    e.preventDefault();
    const addr = email.trim().toLowerCase();
    if (!EMAIL_RE.test(addr)) { setErr('Enter a valid email address'); return; }
    if (addr === user.email?.toLowerCase()) { setErr("That's you — you're already the host"); return; }
    if (invites.some((i) => i.email === addr)) { setErr('Already on the list'); return; }
    setEmail('');
    setErr('');
    setInvites((list) => [...list, { email: addr, status: 'checking', fresh: true }]);
    // Hold "Checking…" for at least 400 ms so the verification moment is visible.
    const [res] = await Promise.all([
      supabase.rpc('check_invites', { emails: [addr] }),
      new Promise((r) => setTimeout(r, 400)),
    ]);
    setStatus(addr, res.error ? 'error' : res.data?.[0]?.status ?? 'no_account');
  };

  const copyLink = async () => {
    const ok = await copyText(inviteLink(partyId));
    toast(ok ? 'Invite link copied — it works once the party is created' : "Couldn't copy the link", ok ? 'ok' : 'warn');
  };

  const create = async () => {
    setCreating(true);
    const { error } = await supabase.rpc('create_party', {
      p_match_id: match.id,
      p_name: name.trim() || 'Watch party',
      p_emails: invites.filter((i) => i.status === 'subscribed').map((i) => i.email),
      p_id: partyId,
      p_settings: { ai_moderation: aiMod, guests_can_poll: false, allow_cameras: true, shared_controls: true },
    });
    setCreating(false);
    if (error) {
      toast(/subscription/.test(error.message) ? 'You need a subscription to host a party' : "Couldn't create the party — try again", 'warn');
      return;
    }
    navigate(`/party/${partyId}/lobby`);
  };

  const ok = invites.filter((i) => i.status === 'subscribed').length;
  const checking = invites.filter((i) => i.status === 'checking').length;
  const blocked = invites.filter((i) => i.status === 'not_subscribed' || i.status === 'no_account').length;
  let summary = `${ok} ${ok === 1 ? 'friend' : 'friends'} will be invited`;
  if (checking) summary += ` · ${checking} checking`;
  if (blocked) summary += ` · ${blocked} need the link`;

  return (
    <div className="overlay" onClick={onClose}>
      <div className="dialog rise-in" role="dialog" aria-modal="true" aria-labelledby="cp-title" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-head">
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <h1 id="cp-title" className="dialog-title">Start a Watch Party</h1>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--muted)', flexWrap: 'wrap' }}>
              <ModeBadge mode={match.mode} small />
              <span>{match.mode === 'replay' && config.final_score
                ? `${config.home} ${config.final_score[config.home]}–${config.final_score[config.away]} ${config.away} · ${config.competition}`
                : `${match.title} · ${config.competition}`}</span>
            </div>
          </div>
          <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}><X size={16} strokeWidth={2.4} /></button>
        </div>

        <div className="dialog-body">
          <div className="field">
            <label htmlFor="cp-name" className="label">Party name</label>
            <input id="cp-name" className="input" style={{ fontSize: 15 }} value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
          </div>

          <div className="field" style={{ gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
              <label htmlFor="cp-email" className="label">Invite friends by email</label>
              <span style={{ fontSize: 12, color: 'var(--muted-3)' }}>We check each friend has an active subscription</span>
            </div>
            <form onSubmit={add} style={{ display: 'flex', gap: 8, margin: 0 }}>
              <input
                id="cp-email" type="email" className={`input ${err ? 'error' : ''}`} placeholder="friend@email.com" autoComplete="off"
                value={email} onChange={(e) => { setEmail(e.target.value); setErr(''); }}
              />
              <button type="submit" className="btn btn-soft">Add</button>
            </form>
            {err && <span role="alert" className="form-error" style={{ fontSize: 12 }}>{err}</span>}
            <ul className="invite-list" aria-label="Invited friends">
              {invites.map((i) => {
                const good = i.status === 'subscribed';
                const needLink = i.status === 'not_subscribed' || i.status === 'no_account';
                return (
                  <li key={i.email} className={`invite-row ${i.fresh ? 'rise-in' : ''}`} style={{ opacity: needLink ? 0.85 : 1 }}>
                    <span className="init" style={{ color: good ? 'var(--accent)' : 'var(--muted-2)' }}>{i.email.charAt(0).toUpperCase()}</span>
                    <div className="who">
                      <span className="email" style={{ color: needLink ? 'var(--muted-2)' : 'var(--text)' }}>{i.email}</span>
                      <span className="sub">{SUB_TEXT[i.status]}</span>
                    </div>
                    <div className="status">
                      {i.status === 'checking' && <span className="pill pill-neutral" role="status"><Spinner />Checking…</span>}
                      {good && <span className="pill pill-ok"><Check size={12} strokeWidth={3} aria-hidden="true" />Subscribed</span>}
                      {i.status === 'not_subscribed' && <span className="pill pill-warn">Not subscribed yet</span>}
                      {i.status === 'no_account' && <span className="pill pill-neutral">No account yet</span>}
                      {i.status === 'error' && <span className="pill pill-warn">Check failed</span>}
                      {needLink && <button type="button" className="btn-link" onClick={copyLink}>Copy invite link</button>}
                    </div>
                    <button type="button" className="icon-btn" style={{ width: 32, height: 32 }} aria-label={`Remove ${i.email}`} onClick={() => setInvites((l) => l.filter((x) => x.email !== i.email))}>
                      <X size={12} strokeWidth={2.6} />
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>

          <div className="setting-row">
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span id="cp-mod" className="t">AI moderation</span>
              <span className="d">Gaffer hides abusive messages. Banter is fine. You can review anything it hides.</span>
            </div>
            <Switch checked={aiMod} onChange={setAiMod} labelledBy="cp-mod" />
          </div>
        </div>

        <div className="dialog-foot">
          <span style={{ flex: 1, minWidth: 180, fontSize: 13, color: 'var(--muted-2)' }}>{summary}</span>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-primary" onClick={create} disabled={creating || checking > 0}>
            {creating && <Spinner />}Create party<ArrowRight size={15} strokeWidth={2.6} aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  );
}
