import { useState } from 'react';
import { Check, Video } from 'lucide-react';
import { useAuth } from '../../context/AuthContext.jsx';
import { useParty } from '../../context/PartyContext.jsx';
import { useCall } from '../../context/CallContext.jsx';
import { teamInfo } from '../../lib/format.js';
import { Avatar, ConfirmDialog, Switch } from '../ui.jsx';
import TestingAloneHint from '../TestingAloneHint.jsx';
import { memberLook } from './ChatTab.jsx';

const SETTINGS = [
  { id: 'shared_controls', label: 'Everyone controls playback', hint: 'Anyone can pause, seek and go live. Off: only you can.', defaultOn: true },
  { id: 'ai_moderation', label: 'AI moderation', hint: 'Gaffer hides abusive messages. You can still review them.' },
  { id: 'guests_can_poll', label: 'Guests can create polls', hint: 'Off: only you and Gaffer start polls.' },
  { id: 'allow_cameras', label: 'Participant cameras', hint: 'Let guests turn on their video. Turning this off stops every guest camera.', defaultOn: true },
];

export default function PeopleTab({ match, onEnd }) {
  const { user } = useAuth();
  const { party, members, online, isHost, updateMember, updateParty, rpc } = useParty();
  const { media, allowCameras, hostStopVideo, hostAskVideo } = useCall();
  const [confirm, setConfirm] = useState(null);
  const [hintHidden, setHintHidden] = useState(false);
  const config = match.config;

  const list = members
    .filter((m) => m.status !== 'removed')
    .sort((a, b) => (a.role === 'host' ? -1 : b.role === 'host' ? 1 : 0) || (a.status === 'joined' ? -1 : 1));
  const joined = list.filter((m) => m.status === 'joined');
  const hostName = members.find((m) => m.role === 'host')?.profile?.display_name ?? 'The host';

  const changeSetting = async (id, value) => {
    const ok = await updateParty({ settings: { ...party.settings, [id]: value } });
    if (ok && id === 'allow_cameras' && !value) {
      const hostName = members.find((m) => m.user_id === user.id)?.profile?.display_name ?? 'The host';
      rpc('post_system_message', { p_party: party.id, p_body: `${hostName} turned off guest cameras` });
    }
  };

  const doConfirm = async () => {
    const c = confirm;
    setConfirm(null);
    if (c.kind === 'end') onEnd();
    if (c.kind === 'remove') updateMember(c.userId, { status: 'removed' });
  };

  return (
    <div className="tab-body scroll">
      <div className="tab-pad">
        {isHost && joined.length <= 1 && !hintHidden && <TestingAloneHint partyId={party.id} onDismiss={() => setHintHidden(true)} />}
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
          <h2 className="tab-h">In this party</h2>
          <span className="tab-num" style={{ fontSize: 12, color: 'var(--muted-3)' }}>{joined.filter((m) => online.has(m.user_id)).length} online · {joined.length} joined</span>
        </div>
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {list.map((m) => {
            const look = memberLook(m, config);
            const team = m.team_supported ? teamInfo(config, m.team_supported) : null;
            const isOnline = online.has(m.user_id);
            const self = m.user_id === user.id;
            return (
              <li key={m.user_id} className={`person ${isOnline ? '' : 'offline'}`}>
                <div className="person-top">
                  <Avatar name={look.name} ring={look.ring} size={38} online={isOnline} />
                  <div className="who">
                    <div className="line1">
                      <span className="nm">{look.name}{self ? ' (you)' : ''}</span>
                      <span className="tag-sm" style={m.role === 'host' ? { color: 'var(--on-accent)', background: 'var(--accent)' } : { color: 'var(--muted)', background: 'var(--line)' }}>
                        {m.role === 'host' ? 'Host' : 'Guest'}
                      </span>
                      {m.status === 'invited' && <span className="tag-sm" style={{ color: 'var(--muted)', background: 'var(--line)' }}>Invited</span>}
                      {m.muted && <span className="tag-sm" style={{ color: 'var(--bg)', background: 'var(--warn)' }}>Muted</span>}
                      {media[m.user_id]?.video && (
                        <span className="tag-sm" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: 'var(--accent-soft)', background: 'var(--accent-a10)' }}>
                          <Video size={11} strokeWidth={2.4} aria-hidden="true" />Video on
                        </span>
                      )}
                    </div>
                    <div className="line2">
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                        <span style={{ width: 8, height: 8, borderRadius: '50%', background: team?.color ?? 'var(--line-4)' }} />
                        {team?.name ?? 'No side picked'}
                      </span>
                      {m.profile?.is_subscribed && (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: 'var(--accent)' }}>
                          <Check size={11} strokeWidth={3} aria-hidden="true" />Premium
                        </span>
                      )}
                      <span>{isOnline ? 'Online' : 'Offline'}</span>
                    </div>
                  </div>
                </div>
                {isHost && !self && (
                  <div className="acts">
                    <button type="button" className="btn btn-xs btn-ghost" onClick={() => updateMember(m.user_id, { muted: !m.muted })}>
                      {m.muted ? 'Unmute in chat' : 'Mute in chat'}
                    </button>
                    {m.status === 'joined' && (media[m.user_id]?.video || allowCameras) && (
                      <button type="button" className="btn btn-xs btn-ghost" onClick={() => (media[m.user_id]?.video ? hostStopVideo(m.user_id) : hostAskVideo(m.user_id))}>
                        {media[m.user_id]?.video ? 'Stop video' : 'Ask to turn on video'}
                      </button>
                    )}
                    <button type="button" className="btn btn-xs btn-danger" onClick={() => setConfirm({ kind: 'remove', userId: m.user_id, name: look.name })}>
                      Remove from party
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>

        {isHost ? (
          <section aria-labelledby="ps-h" className="settings-box">
            <h3 id="ps-h" className="sub-h" style={{ marginBottom: 6 }}>Party settings</h3>
            {SETTINGS.map((s) => (
              <div key={s.id} className="row">
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <span id={`set-${s.id}`} className="t">{s.label}</span>
                  <span className="d">{s.hint}</span>
                </div>
                <Switch
                  checked={s.defaultOn ? party.settings?.[s.id] !== false : !!party.settings?.[s.id]}
                  labelledBy={`set-${s.id}`}
                  onChange={(v) => changeSetting(s.id, v)}
                />
              </div>
            ))}
            <button type="button" className="btn btn-danger" style={{ marginTop: 12, borderColor: 'var(--live)', fontWeight: 700 }} onClick={() => setConfirm({ kind: 'end' })}>
              End party for everyone
            </button>
          </section>
        ) : (
          <p style={{ margin: 0, fontSize: 13, color: 'var(--muted-3)', lineHeight: 1.5 }}>
            {hostName} is the host. {party.settings?.shared_controls === false ? 'Only the host can control playback, manage' : 'Everyone can control playback; only the host can manage'} participants and change party settings.
          </p>
        )}
      </div>

      {confirm && (
        <ConfirmDialog
          title={confirm.kind === 'end' ? 'End the party for everyone?' : `Remove ${confirm.name}?`}
          body={confirm.kind === 'end'
            ? 'Playback stops and everyone sees the recap. This cannot be undone.'
            : `${confirm.name} will be taken out of the room and can't rejoin with the invite link.`}
          cta={confirm.kind === 'end' ? 'End party' : 'Remove'}
          danger
          onCancel={() => setConfirm(null)}
          onConfirm={doConfirm}
        />
      )}
    </div>
  );
}
