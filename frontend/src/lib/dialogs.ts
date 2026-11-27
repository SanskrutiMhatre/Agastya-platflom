// WP-35 (GAP-002): one dialog service for the whole application. React pages and the framework-free editors (jsg/*, which cannot
// import React components) call the same functions; `components/DialogHost.tsx`, mounted once by the App, renders the request as the
// themed Modal (focus moves in and returns, Escape closes the top dialog, danger tone). There is no `window.confirm`, `window.prompt`
// or `window.alert` anywhere in `src/` (the architecture test `dialogs.test.ts` holds it).
//
// The functions are asynchronous: a caller that used `if (confirm(...))` awaits the answer instead. When no host is mounted (a unit test
// of an editor, a pop-out window), the request stays queued until one is; nothing falls back to the browser's own dialog.

export type DialogKind = 'confirm' | 'prompt' | 'alert';

export interface DialogOptions {
  title: string;
  /** What happens, in plain words; for a destructive action the exact consequence ("removes plate 3 and its 14 parts"). */
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Red confirm button: the action removes or replaces something. */
  danger?: boolean;
}

export interface PromptOptions extends DialogOptions {
  label: string;
  initial?: string;
  hint?: string;
  /** A text area (pasted rows, several lines) instead of a one-line field. */
  multiline?: boolean;
}

export interface DialogRequest {
  id: number;
  kind: DialogKind;
  options: DialogOptions & Partial<PromptOptions>;
  resolve: (value: boolean | string | null) => void;
}

let seq = 0;
let queue: DialogRequest[] = [];
const listeners = new Set<() => void>();
const emit = () => { for (const l of listeners) l(); };

function open(kind: DialogKind, options: DialogOptions & Partial<PromptOptions>): Promise<boolean | string | null> {
  return new Promise((resolve) => {
    const req: DialogRequest = {
      id: ++seq, kind, options,
      resolve: (v) => { queue = queue.filter((r) => r !== req); emit(); resolve(v); },
    };
    queue = [...queue, req];
    emit();
  });
}

/** Ask yes or no. Resolves true only when the person presses the confirm button. */
export const confirmDialog = (o: DialogOptions): Promise<boolean> => open('confirm', o).then((v) => v === true);

/** Ask for a text. Resolves the text (untrimmed) on confirm, null on cancel. */
export const promptDialog = (o: PromptOptions): Promise<string | null> => open('prompt', o).then((v) => (typeof v === 'string' ? v : null));

/** Tell something that needs an acknowledgement (a toast is the better choice for most messages). */
export const alertDialog = (o: DialogOptions): Promise<void> => open('alert', o).then(() => undefined);

/** The open requests, oldest first; the host shows them stacked, the newest on top. */
export const dialogQueue = (): DialogRequest[] => queue;

export function subscribeDialogs(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}
