// Unsaved work must not vanish because someone clicked a tab. A page that holds changes the server does not have yet calls useLeaveGuard(dirty, ...) and renders what it returns:
//   - going to another page of the app (a rail tab, the back arrow, the browser's Back button) is held back and the author is asked: stay, leave without saving, or save and leave;
//   - closing or reloading the browser tab asks the browser's own question (a page cannot show its own dialog then).
// Moving inside the same page (a query string such as ?goto=...) is not "leaving".

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useBlocker } from 'react-router-dom';
import { Modal, Spinner } from '../components/ui';

export interface LeaveGuardOptions {
  /** what is unsaved, in the sentence "You have unsaved ..." */
  what?: string;
  /** Save and leave: resolves true when the work is saved (the page then opens), false when it could not be (the author stays). */
  save?: () => Promise<boolean>;
  /** false when the page already asks the browser before the tab closes */
  unload?: boolean;
}

export function useLeaveGuard(dirty: boolean, { what = 'changes', save, unload = true }: LeaveGuardOptions = {}): ReactNode {
  useEffect(() => {
    if (!unload || !dirty) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty, unload]);

  const block = useCallback(({ currentLocation, nextLocation }: { currentLocation: { pathname: string }; nextLocation: { pathname: string } }) => dirty && currentLocation.pathname !== nextLocation.pathname, [dirty]);
  const blocker = useBlocker(block);
  const [busy, setBusy] = useState(false);
  if (blocker.state !== 'blocked') return null;

  const saveAndLeave = async () => {
    if (!save) return;
    setBusy(true);
    try { if (await save()) blocker.proceed(); else blocker.reset(); } finally { setBusy(false); }
  };
  return (
    <Modal title="Leave without saving?" onClose={() => blocker.reset()} width={460} buttons={<>
      <button className="btn" onClick={() => blocker.reset()} disabled={busy} data-testid="leave-stay">Stay here</button>
      <button className="btn" onClick={() => blocker.proceed()} disabled={busy} data-testid="leave-discard">Leave without saving</button>
      {save ? <button className="btn btn-primary" onClick={() => void saveAndLeave()} disabled={busy} data-testid="leave-save">{busy ? <Spinner /> : null}Save and leave</button> : null}
    </>}>
      <p style={{ margin: 0 }}>You have unsaved {what}. If you leave now they are lost.</p>
    </Modal>
  );
}
