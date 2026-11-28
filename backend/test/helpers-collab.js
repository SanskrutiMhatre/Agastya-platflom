'use strict';
// Phase 3 (P3-1): a headless live co-editing client for the backend tests and the load script (scripts/bench/collab-load.js). It speaks the
// binary protocol of shared/collab/protocol.ts over a real /ws connection with a real session cookie, keeps its own Y document, and
// records every frame it receives. It is what a binding does, without the DOM: join with a state vector, send local changes with a
// sequence number, wait for ACK, answer SYNC1 with what the server lacks, apply REMOTE and SYNC2.
const WebSocket = require('ws');
const Y = require('yjs');
const awarenessProtocol = require('y-protocols/awareness');

const ORIGIN_REMOTE = Symbol('remote');

class CollabClient {
  /**
   * @param base  the server's http base (http://127.0.0.1:port)
   * @param cookie the session cookie ("agastya_session=...")
   */
  constructor(base, cookie, { origin = base } = {}) {
    this.base = base; this.cookie = cookie; this.origin = origin;
    this.proto = require('../dist/shared/collab/protocol');
    this.rooms = new Map();
    this.frames = [];
    this.waiters = [];
    this.seq = 0;
  }

  open() {
    return new Promise((resolve, reject) => {
      const headers = { origin: this.origin }; if (this.cookie) headers.cookie = this.cookie;
      const ws = new WebSocket(this.base.replace(/^http/, 'ws') + '/ws', { headers });
      ws.binaryType = 'nodebuffer';
      this.ws = ws;
      this.closed = new Promise((r) => ws.on('close', (code, reason) => r({ code, reason: String(reason) })));
      ws.on('open', () => resolve(this));
      ws.on('unexpected-response', (_q, res) => reject(Object.assign(new Error(`upgrade refused ${res.statusCode}`), { status: res.statusCode })));
      ws.on('error', (e) => reject(e));
      ws.on('message', (data, isBinary) => {
        if (!isBinary) return;                                  // JSON progress/presence lines are not ours
        const m = this.proto.decode(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
        if (!m) return;
        m.at = Date.now();
        this.onFrame(m);
        this.frames.push(m);
        for (const w of [...this.waiters]) if (w.pred(m)) { this.waiters.splice(this.waiters.indexOf(w), 1); w.resolve(m); }
      });
    });
  }

  room(name) {
    let r = this.rooms.get(name);
    if (!r) {
      const doc = new Y.Doc();
      r = { name, doc, epoch: '', state: null, acked: 0, sent: new Map(), awareness: new awarenessProtocol.Awareness(doc), errors: [] };
      r.awareness.setLocalState(null);
      doc.on('update', (u, origin) => {
        if (origin === ORIGIN_REMOTE) return;
        const seq = ++this.seq;
        r.sent.set(seq, u);
        this.send(this.proto.enc.update(name, seq, u));
      });
      this.rooms.set(name, r);
    }
    return r;
  }

  onFrame(m) {
    const r = this.rooms.get(m.room);
    if (!r) return;
    const { MSG } = this.proto;
    switch (m.type) {
      case MSG.STATE: r.state = m.state; if (m.state.epoch) r.epoch = m.state.epoch; break;
      case MSG.SYNC2:
        if (m.reset) { /* a new epoch: a real binding rebuilds; tests start fresh */ }
        Y.applyUpdate(r.doc, m.update, ORIGIN_REMOTE); break;
      case MSG.REMOTE: Y.applyUpdate(r.doc, m.update, ORIGIN_REMOTE); break;
      case MSG.SYNC1: {
        const diff = Y.encodeStateAsUpdate(r.doc, m.sv);
        if (diff.length > 2) { const seq = ++this.seq; r.sent.set(seq, diff); this.send(this.proto.enc.update(m.room, seq, diff)); }
        break;
      }
      case MSG.ACK: r.acked = Math.max(r.acked, m.seq); for (const s of [...r.sent.keys()]) if (s <= m.seq) r.sent.delete(s); break;
      case MSG.AWARE: awarenessProtocol.applyAwarenessUpdate(r.awareness, m.update, ORIGIN_REMOTE); break;
      case MSG.ERROR: r.errors.push(m.error); break;
      default: break;
    }
  }

  send(frame) { if (this.ws && this.ws.readyState === 1) this.ws.send(frame); }

  /** Join a room; resolves once the first SYNC2 arrived (the document is here), or with the ERROR the server sent. */
  async join(name) {
    const r = this.room(name);
    const got = this.waitFor((m) => m.room === name && (m.type === this.proto.MSG.SYNC2 || m.type === this.proto.MSG.ERROR), 8000);
    this.send(this.proto.enc.join(name, r.epoch, Y.encodeStateVector(r.doc)));
    const m = await got;
    if (!m) throw new Error(`no answer to JOIN ${name}`);
    if (m.type === this.proto.MSG.ERROR) return { error: m.error, room: r };
    return { room: r };
  }

  leave(name) { this.send(this.proto.enc.leave(name)); }

  /** Ask for a write-back (revision: also a history entry); resolves with FLUSHED. */
  async flush(name, revision = true) {
    const seq = ++this.seq;
    const got = this.waitFor((m) => m.room === name && m.type === this.proto.MSG.FLUSHED && m.seq === seq, 10000);
    this.send(this.proto.enc.flush(name, seq, revision));
    return got;
  }

  /** Publish an awareness state (null to leave), as a page does. */
  setAwareness(name, state) {
    const r = this.room(name);
    r.awareness.setLocalState(state);
    this.send(this.proto.enc.awareness(name, awarenessProtocol.encodeAwarenessUpdate(r.awareness, [r.doc.clientID])));
  }

  /** Every update sent so far acknowledged? Waits up to `ms`. */
  async settled(name, ms = 5000) {
    const r = this.room(name);
    const until = Date.now() + ms;
    while (r.sent.size && Date.now() < until) await new Promise((res) => setTimeout(res, 20));
    return r.sent.size === 0;
  }

  waitFor(pred, ms = 3000) {
    const hit = this.frames.find(pred); if (hit) return Promise.resolve(hit);
    return new Promise((resolve) => {
      const w = { pred, resolve }; this.waiters.push(w);
      setTimeout(() => { const i = this.waiters.indexOf(w); if (i >= 0) { this.waiters.splice(i, 1); resolve(null); } }, ms);
    });
  }

  close() { try { this.ws.close(); } catch { /* closed */ } for (const r of this.rooms.values()) { r.awareness.destroy(); r.doc.destroy(); } }
}

// The tree as the document has it (schema 2, shared/collab/ydom.ts): a block's element where its live placeholder is.
const kids = (node) => require('../dist/shared/collab/ydom').ychildren(node);

/** The text content of a Y XML tree (for assertions): every Y.XmlText under `node`, in order. */
function textOf(node) {
  if (node instanceof Y.XmlText) return node.toString().replace(/<[^>]*>/g, '');
  let s = '';
  kids(node).forEach((c) => { s += textOf(c); });
  return s;
}

/** The first Y.XmlElement named `name` (depth first). */
function findEl(node, name) {
  let hit = null;
  kids(node).forEach((c) => {
    if (hit) return;
    if (c instanceof Y.XmlElement) { if (c.nodeName === name) hit = c; else hit = findEl(c, name); }
  });
  return hit;
}

/** The first Y.XmlText under `node`. */
function firstText(node) {
  let hit = null;
  kids(node).forEach((c) => {
    if (hit) return;
    if (c instanceof Y.XmlText) hit = c; else if (c instanceof Y.XmlElement) hit = firstText(c);
  });
  return hit;
}

const until = async (fn, ms = 5000, step = 25) => {
  const end = Date.now() + ms;
  for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) return v; await new Promise((r) => setTimeout(r, step)); }
};

module.exports = { CollabClient, textOf, findEl, firstText, until, Y };
