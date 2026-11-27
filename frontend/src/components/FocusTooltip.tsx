// UID-003: the hints of icon-only controls live in the `title` attribute (over 200 places), which the browser shows only on mouse
// hover. This layer shows the same text, themed, when such a control receives keyboard focus (:focus-visible), and hides it on blur
// or Escape. Mouse users keep the native tooltip (the title stays, so nothing loses its name or its test hook).
import { useEffect, useState } from 'react';

interface Tip { text: string; x: number; y: number }

export function FocusTooltip() {
  const [tip, setTip] = useState<Tip | null>(null);
  useEffect(() => {
    const show = (e: FocusEvent) => {
      const el = e.target instanceof HTMLElement ? e.target : null;
      if (!el || !el.title || el.closest('.v2-rail')) { setTip(null); return; }        // the project rail has its own data-tip labels
      let visible = false;
      try { visible = el.matches(':focus-visible'); } catch { visible = false; }
      if (!visible) { setTip(null); return; }
      const r = el.getBoundingClientRect();
      const below = r.bottom + 40 < window.innerHeight;
      setTip({ text: el.title, x: Math.max(8, Math.min(r.left, window.innerWidth - 328)), y: below ? r.bottom + 6 : Math.max(8, r.top - 34) });
    };
    const hide = () => setTip(null);
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setTip(null); };
    document.addEventListener('focusin', show);
    document.addEventListener('focusout', hide);
    document.addEventListener('keydown', esc, true);
    window.addEventListener('scroll', hide, true);
    return () => {
      document.removeEventListener('focusin', show);
      document.removeEventListener('focusout', hide);
      document.removeEventListener('keydown', esc, true);
      window.removeEventListener('scroll', hide, true);
    };
  }, []);
  if (!tip) return null;
  return <div className="v2-ktip" role="tooltip" data-testid="focus-tooltip" style={{ left: tip.x, top: tip.y }}>{tip.text}</div>;
}
