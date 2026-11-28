// WP-35 (GAP-002): renders the requests of `lib/dialogs.ts` as the themed Modal. Mounted once by the App (and by the pop-out preview
// window); the newest request is on top and Escape closes only it (the Modal's dialog stack). Focus starts on Cancel for a destructive
// question and on the confirm button otherwise.

import { useState, useSyncExternalStore } from 'react';
import { dialogQueue, subscribeDialogs, type DialogRequest } from '../lib/dialogs';
import { Field, Modal } from './ui';

export function DialogHost() {
  const queue = useSyncExternalStore(subscribeDialogs, dialogQueue, dialogQueue);
  return <>{queue.map((r) => <ServiceDialog key={r.id} req={r} />)}</>;
}

function ServiceDialog({ req }: { req: DialogRequest }) {
  const o = req.options;
  const [value, setValue] = useState(o.initial ?? '');
  const cancel = () => req.resolve(req.kind === 'confirm' ? false : null);
  const ok = () => req.resolve(req.kind === 'prompt' ? value : true);
  const confirmLabel = o.confirmLabel ?? (req.kind === 'alert' ? 'OK' : req.kind === 'prompt' ? 'OK' : 'Confirm');
  return (
    // a question or a notice is the mockup's confirm dialog (admin.html: the tone's icon in a tinted circle); a prompt is a form dialog
    <Modal title={o.title} onClose={cancel} width={req.kind === 'prompt' && o.multiline ? 560 : 460}
      icon={req.kind === 'prompt' ? undefined : o.danger ? 'alert' : 'info'} tone={o.danger ? 'danger' : 'info'} buttons={<>
      {req.kind === 'alert' ? null : <button type="button" className="btn" onClick={cancel} data-testid="app-dialog-cancel" autoFocus={!!o.danger}>{o.cancelLabel ?? 'Cancel'}</button>}
      <button type="button" className={`btn btn-primary ${o.danger ? 'btn-danger-solid' : ''}`} onClick={ok} data-testid="app-dialog-confirm"
        autoFocus={req.kind !== 'prompt' && !o.danger}>{confirmLabel}</button>
    </>}>
      <div className="v2-stack" data-testid="app-dialog" data-kind={req.kind}>
        {o.message ? <p className="confirm-text">{o.message}</p> : null}
        {req.kind === 'prompt' ? (
          <Field label={o.label ?? o.title} hint={o.hint}>
            {o.multiline
              ? <textarea className="v2-textarea v2-dialog-area" autoFocus value={value} onChange={(e) => setValue(e.target.value)} data-testid="app-dialog-input" rows={8} />
              : <input className="v2-input" autoFocus value={value} onChange={(e) => setValue(e.target.value)} data-testid="app-dialog-input"
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); ok(); } }} />}
          </Field>
        ) : null}
      </div>
    </Modal>
  );
}
