'use strict';
/*
  Eclipse LemMinX, the XML language server, driven over stdio.

  What it adds that our own validation cannot: while you are typing inside a
  data module it can say which elements are ALLOWED next, and what the schema
  says each one means. Working that out means walking an XSD content model,
  which is a real piece of engineering and one that already exists here.

  It is a separate process speaking LSP, not a library linked into this
  application. That keeps the EPL-2.0 boundary clean (see
  server/tools/lemminx/NOTICE.md) and means a crash in it costs a feature
  rather than the editor.

  Offline by construction. Every S1000D module names its schema by an
  http://www.s1000d.org/... URL, and left alone LemMinX would fetch it —
  breaking the promise INSTALL.md makes to customers that this application
  never sends anything anywhere. Downloads are therefore disabled outright AND
  an XML catalogue rewrites those URLs onto the schema sets on disk, so the
  schema is found locally and the question of the network never arises.
*/
const { spawn } = require('child_process');
const { writeCatalog } = require('./catalog');
const fs = require('fs');
const os = require('os');
const path = require('path');
const toolPaths = require('./paths');

const JAR = path.join(toolPaths.TOOLS, 'lemminx', 'org.eclipse.lemminx-uber.jar');
const HEADER_SEP = '\r\n\r\n';

const available = () => {
    try { return fs.existsSync(JAR) && fs.existsSync(toolPaths.JAVA); } catch { return false; }
};

/*
  The catalogue lives in engine/catalog.js and is shared with the build and the
  validator. It used to be built here as well, which meant two generators of
  the same mapping — and the moment one learned about the entity sets and the
  other did not, the editor and the PDF would disagree about what a document
  means.
*/
class Lemminx {
    constructor() {
        this.proc = null;
        this.buf = Buffer.alloc(0);
        this.pending = new Map();
        this.nextId = 1;
        this.ready = null;
        this.opened = new Map();   // uri -> version
    }

    start() {
        if (this.ready) return this.ready;
        this.ready = new Promise((resolve, reject) => {
            if (!available()) return reject(new Error('LemMinX is not installed with this build'));
            const cat = writeCatalog();
            this.proc = spawn(toolPaths.JAVA, ['-jar', JAR], { stdio: ['pipe', 'pipe', 'pipe'], env: toolPaths.childEnv(), windowsHide: true });   // the allow-listed environment (WP-02)
            this.proc.on('error', reject);
            this.proc.on('exit', () => { this.proc = null; this.ready = null; this.opened.clear(); });
            this.proc.stdout.on('data', (d) => this._read(d));
            this.proc.stderr.on('data', () => { /* its logging is not ours to print */ });

            this._request('initialize', {
                processId: process.pid,
                rootUri: null,
                capabilities: {
                    textDocument: {
                        completion: { completionItem: { snippetSupport: false, documentationFormat: ['plaintext'] } },
                        hover: { contentFormat: ['plaintext'] },
                    },
                },
                initializationOptions: {
                    settings: {
                        xml: {
                            // Never reach the network: the promise in INSTALL.md.
                            downloadExternalResources: { enabled: false },
                            validation: { enabled: true },
                            catalogs: cat ? [cat] : [],
                        },
                    },
                },
            }, 30000).then((r) => { this._notify('initialized', {}); resolve(r.result); }, reject);
        });
        return this.ready;
    }

    _read(d) {
        this.buf = Buffer.concat([this.buf, d]);
        for (;;) {
            const sep = this.buf.indexOf(HEADER_SEP);
            if (sep < 0) return;
            const m = /Content-Length:\s*(\d+)/i.exec(this.buf.slice(0, sep).toString('ascii'));
            if (!m) return;
            const len = Number(m[1]);
            const start = sep + HEADER_SEP.length;
            if (this.buf.length < start + len) return;
            const body = this.buf.slice(start, start + len).toString('utf8');
            this.buf = this.buf.slice(start + len);
            let msg;
            try { msg = JSON.parse(body); } catch { continue; }
            if (msg.id !== undefined && this.pending.has(msg.id)) {
                this.pending.get(msg.id)(msg);
                this.pending.delete(msg.id);
            }
        }
    }

    _send(o) {
        if (!this.proc) throw new Error('LemMinX is not running');
        const s = JSON.stringify(o);
        this.proc.stdin.write('Content-Length: ' + Buffer.byteLength(s, 'utf8') + HEADER_SEP + s);
    }

    _notify(method, params) { this._send({ jsonrpc: '2.0', method, params }); }

    _request(method, params, timeoutMs) {
        const id = this.nextId++;
        return new Promise((resolve, reject) => {
            /*
              A language server that stops answering must not hang the editor.
              On a timeout the feature degrades to nothing and the document is
              still perfectly editable — which is the right failure for
              something that only ever offers help.
            */
            const timer = setTimeout(() => {
                this.pending.delete(id);
                reject(new Error(method + ' timed out'));
            }, timeoutMs || 10000);
            this.pending.set(id, (msg) => { clearTimeout(timer); resolve(msg); });
            try { this._send({ jsonrpc: '2.0', id, method, params }); }
            catch (e) { clearTimeout(timer); this.pending.delete(id); reject(e); }
        });
    }

    /*
      The server needs the document before it can answer about it. Re-opening
      the same uri on every keystroke would make it re-parse from scratch, so
      the first sight of a document is didOpen and every later one is
      didChange with a rising version.
    */
    sync(uri, text) {
        const v = (this.opened.get(uri) || 0) + 1;
        if (v === 1) {
            this._notify('textDocument/didOpen', { textDocument: { uri, languageId: 'xml', version: v, text } });
        } else {
            this._notify('textDocument/didChange', { textDocument: { uri, version: v }, contentChanges: [{ text }] });
        }
        this.opened.set(uri, v);
    }

    async completion(uri, text, line, character) {
        await this.start();
        this.sync(uri, text);
        const r = await this._request('textDocument/completion', {
            textDocument: { uri }, position: { line, character },
        });
        const items = (r.result && (r.result.items || r.result)) || [];
        return items.map((i) => ({
            label: i.label,
            kind: i.kind,
            detail: i.detail || '',
            documentation: typeof i.documentation === 'string'
                ? i.documentation
                : (i.documentation && i.documentation.value) || '',
            insertText: (i.textEdit && i.textEdit.newText) || i.insertText || i.label,
        }));
    }

    async hover(uri, text, line, character) {
        await this.start();
        this.sync(uri, text);
        const r = await this._request('textDocument/hover', {
            textDocument: { uri }, position: { line, character },
        });
        const c = r.result && r.result.contents;
        if (!c) return null;
        const value = typeof c === 'string'
            ? c
            : (Array.isArray(c) ? c.map((x) => (typeof x === 'string' ? x : x.value)).join('\n') : c.value);
        return value ? { value } : null;
    }

    stop() { try { if (this.proc) this.proc.kill(); } catch { /* already gone */ } }
}

const server = new Lemminx();
module.exports = { server, available, writeCatalog };
