// Build progress over the authenticated /ws socket. One shared connection; each
// message is tagged with its project id and the server only sends a project's
// messages to people who can read that project.

import { useEffect, useState } from 'react';

export interface ProgressMsg { type: 'progress' | 'reload'; projectId: string; message?: string; done?: boolean; error?: boolean; file?: string; line?: number; hint?: string; preview?: boolean; kind?: string }

type Listener = (m: ProgressMsg) => void;
const listeners = new Set<Listener>();
let socket: WebSocket | null = null;
let retry = 0;
let wanted = 0;

function connect() {
  if (socket || wanted === 0) return;
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${proto}://${location.host}/ws`);
  socket = ws;
  ws.onopen = () => { retry = 0; };
  ws.onmessage = (ev) => { try { const m = JSON.parse(ev.data) as ProgressMsg; listeners.forEach((l) => l(m)); } catch { /* ignore malformed */ } };
  ws.onclose = () => {
    socket = null;
    if (wanted > 0) setTimeout(connect, Math.min(10000, 500 * 2 ** retry++));
  };
  ws.onerror = () => ws.close();
}

export function subscribe(l: Listener): () => void {
  listeners.add(l); wanted++; connect();
  return () => { listeners.delete(l); wanted--; if (wanted === 0) { socket?.close(); socket = null; } };
}

export interface ProgressState { lines: string[]; failed: ProgressMsg | null; reloadTick: number; clear: () => void }

export function useProgress(projectId: string): ProgressState {
  const [lines, setLines] = useState<string[]>([]);
  const [failed, setFailed] = useState<ProgressMsg | null>(null);
  const [reloadTick, setTick] = useState(0);
  useEffect(() => subscribe((m) => {
    if (m.projectId !== projectId || m.preview) return;
    if (m.type === 'reload') { setTick((t) => t + 1); return; }
    if (m.message) setLines((l) => [...l.slice(-199), m.message!]);
    if (m.error) setFailed(m);
  }), [projectId]);
  return { lines, failed, reloadTick, clear: () => { setLines([]); setFailed(null); } };
}
