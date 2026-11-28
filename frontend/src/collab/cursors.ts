// =============================================================================
// Live co-editing (Phase 3, P3-1): the other people's carets and selections on the Studio's canvas.
//
// Each person publishes, in the room's awareness, their name, a colour (a theme token, so both themes work) and their selection as two Y
// relative positions. This layer turns those back into places in this page's document (DomBinding.posOf), then into places in the canvas
// (DesignView.modelToDom) and draws a thin caret with the person's name, and their selection as a light band. It redraws when someone
// moves, when the document changes, and when the canvas scrolls or resizes; it never takes focus or events (pointer-events: none).
// =============================================================================

import type { DocumentEditor } from '../studio/ui/editor';
import type { AwarenessState } from '../../../backend/src/shared/collab/protocol';
import type { DomBinding } from './binding';
import type { LiveRoom } from './client';

/** The colours a person can get: existing theme tokens (lint:theme allows no literal colour). */
export const PRESENCE_COLORS = ['info-solid', 'success-solid', 'warning-solid', 'danger-solid', 'accent', 'syntax-tag', 'syntax-attr', 'syntax-value'];
export function colorFor(userId: string): string {
  let h = 0; for (let i = 0; i < userId.length; i++) h = (h * 31 + userId.charCodeAt(i)) >>> 0;
  return PRESENCE_COLORS[h % PRESENCE_COLORS.length];
}

export class CursorLayer {
  readonly el: HTMLElement;
  private frame = 0;
  private readonly redraw = (): void => this.schedule();
  private ro: ResizeObserver | null = null;

  constructor(private ed: DocumentEditor, private binding: DomBinding, private room: LiveRoom) {
    this.el = document.createElement('div');
    this.el.className = 'collab-cursors';
    this.el.setAttribute('aria-hidden', 'true');
    this.el.dataset.testid = 'collab-cursors';
    ed.design.el.appendChild(this.el);
    ed.design.el.addEventListener('scroll', this.redraw, { passive: true });
    room.awareness.on('change', this.redraw);
    ed.doc.addEventListener('change', this.redraw);
    if (typeof ResizeObserver !== 'undefined') { this.ro = new ResizeObserver(this.redraw); this.ro.observe(ed.design.el); }
  }

  destroy(): void {
    if (this.frame) cancelAnimationFrame(this.frame);
    this.ed.design.el.removeEventListener('scroll', this.redraw);
    this.room.awareness.off('change', this.redraw);
    this.ed.doc.removeEventListener('change', this.redraw);
    this.ro?.disconnect();
    this.el.remove();
  }

  schedule(): void { if (!this.frame) this.frame = requestAnimationFrame(() => { this.frame = 0; this.draw(); }); }

  /** Who else is in the document now (one entry per person: a person with two tabs shows once). */
  people(): Array<{ id: string; name: string; color: string; mode: string }> {
    const out = new Map<string, { id: string; name: string; color: string; mode: string }>();
    for (const [client, st] of this.room.awareness.getStates()) {
      const s = st as AwarenessState | null;
      if (client === this.room.doc.clientID || !s?.user) continue;
      out.set(s.user.id, { id: s.user.id, name: s.user.name, color: s.user.color, mode: s.mode ?? 'editing' });
    }
    return [...out.values()];
  }

  private draw(): void {
    const host = this.ed.design.el;
    const box = host.getBoundingClientRect();
    const frag = document.createDocumentFragment();
    if (this.ed.mode !== 'xml') {
      for (const [client, st] of this.room.awareness.getStates()) {
        const s = st as AwarenessState | null;
        if (client === this.room.doc.clientID || !s?.user || !s.cursor) continue;
        const a = this.binding.posOf(s.cursor.anchor); const f = this.binding.posOf(s.cursor.head);
        if (!f) continue;
        const va = a ? this.ed.design.modelToDom(a) : null; const vf = this.ed.design.modelToDom(f);
        if (!vf) continue;
        const color = `var(--${PRESENCE_COLORS.includes(s.user.color) ? s.user.color : 'accent'})`;
        try {
          const r = document.createRange();
          if (va && (va.node !== vf.node || va.offset !== vf.offset)) {
            const before = va.node.compareDocumentPosition(vf.node) & Node.DOCUMENT_POSITION_FOLLOWING || (va.node === vf.node && va.offset < vf.offset);
            if (before) { r.setStart(va.node, va.offset); r.setEnd(vf.node, vf.offset); } else { r.setStart(vf.node, vf.offset); r.setEnd(va.node, va.offset); }
            for (const rc of Array.from(r.getClientRects())) {
              const band = document.createElement('span'); band.className = 'collab-sel';
              band.style.setProperty('--collab-color', color);
              Object.assign(band.style, { left: `${rc.left - box.left + host.scrollLeft}px`, top: `${rc.top - box.top + host.scrollTop}px`, width: `${rc.width}px`, height: `${rc.height}px` });
              frag.appendChild(band);
            }
          }
          r.setStart(vf.node, vf.offset); r.collapse(true);
          const rc = r.getClientRects()[0] ?? (vf.node.nodeType === 1 ? (vf.node as Element).getBoundingClientRect() : (vf.node.parentElement?.getBoundingClientRect() ?? null));
          if (!rc) continue;
          const caret = document.createElement('span'); caret.className = 'collab-caret';
          caret.style.setProperty('--collab-color', color);
          Object.assign(caret.style, { left: `${rc.left - box.left + host.scrollLeft}px`, top: `${rc.top - box.top + host.scrollTop}px`, height: `${Math.max(12, rc.height)}px` });
          const tag = document.createElement('span'); tag.className = 'collab-name'; tag.textContent = s.user.name;
          caret.dataset.user = s.user.id;
          caret.appendChild(tag);
          frag.appendChild(caret);
        } catch { /* a position the canvas cannot show (folded, generated text) */ }
      }
    }
    this.el.replaceChildren(frag);
  }
}
