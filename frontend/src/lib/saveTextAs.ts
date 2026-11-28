// "Save a copy" of a short text (Phase 3, P3-6: the standalone default credentials). The person chooses where: the browser's save dialog
// (File System Access API, which Edge, Chrome and the WebView2 shell have) writes the file they pick, and nothing is written without it.
// Where that API is missing the text goes to an ordinary download, which the browser saves as it is set up to (it may ask, or put it in
// Downloads); the caller says so. Never stored anywhere by the page itself.

interface SaveFilePickerWindow {
  showSaveFilePicker?: (o: { suggestedName?: string; types?: Array<{ description: string; accept: Record<string, string[]> }> }) => Promise<{
    createWritable: () => Promise<{ write: (data: Blob | string) => Promise<void>; close: () => Promise<void> }>;
  }>;
}

/** 'saved' = written where the person chose; 'downloaded' = handed to the browser's download; 'cancelled' = the person closed the dialog. */
export type SaveOutcome = 'saved' | 'downloaded' | 'cancelled';

export async function saveTextAs(text: string, suggestedName: string): Promise<SaveOutcome> {
  const w = window as unknown as SaveFilePickerWindow;
  if (typeof w.showSaveFilePicker === 'function') {
    try {
      const handle = await w.showSaveFilePicker({ suggestedName, types: [{ description: 'Text file', accept: { 'text/plain': ['.txt'] } }] });
      const out = await handle.createWritable();
      await out.write(new Blob([text], { type: 'text/plain;charset=utf-8' }));
      await out.close();
      return 'saved';
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return 'cancelled';
      // a picker that exists but is refused (a sandboxed frame): fall back to the download below
    }
  }
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
  try {
    const a = document.createElement('a');
    a.href = url; a.download = suggestedName; a.rel = 'noopener';
    document.body.appendChild(a); a.click(); a.remove();
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }
  return 'downloaded';
}
