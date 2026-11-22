// A line between the editor and its pop-out preview windows (same browser, same project).
//
// Quick preview and Generate can each be opened in a window of their own. The editor stays the
// one place that knows the text being edited, so a pop-out only asks the editor to run
// ("run") and shows whatever it is sent ("result"). Messages carry the project id in the channel
// name, so two projects never hear each other.

export type Mode = 'quick' | 'build';

export type ToEditor =
  | { t: 'hello'; mode: Mode }          // a pop-out opened (or reloaded)
  | { t: 'bye'; mode: Mode }            // it was closed
  | { t: 'run'; mode: Mode };           // its button was pressed

export type ToPopout =
  | { t: 'editor-here' }                                                                  // answers 'hello': an editor is open and will serve requests
  | { t: 'busy'; mode: Mode; on: boolean }
  | { t: 'result'; mode: Mode; src: string | Blob; label: string; note: string }
  | { t: 'problem'; mode: Mode; message: string; hint?: string };

export const channelFor = (projectId: string): BroadcastChannel => new BroadcastChannel(`agastya.preview.${projectId}`);

export const popoutUrl = (projectId: string, mode: Mode): string => `/preview/${projectId}/${mode}`;

/** Open (or focus) the pop-out window for one mode. Returns null when the browser blocked it. */
export function openPopout(projectId: string, mode: Mode): Window | null {
  const w = window.open(popoutUrl(projectId, mode), `agastya-${mode}-${projectId}`, 'popup=yes,width=900,height=1000');
  w?.focus();
  return w;
}
