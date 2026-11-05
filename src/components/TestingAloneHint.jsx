import { useState } from 'react';
import { Copy, Check, FlaskConical, X } from 'lucide-react';
import { copyText, inviteLink } from '../lib/format.js';
import { useToast } from '../context/ToastContext.jsx';

export default function TestingAloneHint({ partyId, onDismiss }) {
  const toast = useToast();
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    const ok = await copyText(inviteLink(partyId));
    setCopied(ok);
    toast(ok ? 'Invite link copied' : "Couldn't copy — select the link instead", ok ? 'ok' : 'warn');
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <div className="hint-box" role="note">
      <FlaskConical size={20} strokeWidth={2} style={{ color: 'var(--accent)', flexShrink: 0, marginTop: 1 }} aria-hidden="true" />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, flex: 1 }}>
        <span className="t">Testing alone?</span>
        <span className="b">
          Copy the invite link, open it in an incognito window, create a second account with any email, subscribe, and join.
          Put the windows side by side to see sync, chat and Gaffer in real time.
        </span>
        <button type="button" className="btn btn-xs btn-soft" style={{ alignSelf: 'flex-start' }} onClick={copy}>
          {copied ? <Check size={13} strokeWidth={3} aria-hidden="true" /> : <Copy size={13} strokeWidth={2} aria-hidden="true" />}
          {copied ? 'Copied' : 'Copy invite link'}
        </button>
      </div>
      {onDismiss && (
        <button type="button" className="icon-btn" style={{ width: 30, height: 30 }} aria-label="Dismiss" onClick={onDismiss}>
          <X size={14} strokeWidth={2.4} />
        </button>
      )}
    </div>
  );
}
