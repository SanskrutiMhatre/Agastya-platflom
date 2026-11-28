import { Icon } from './Icon';
import { useUi, type ThemeChoice } from '../store/ui';

/**
 * UI redesign step 1 (owner-approved mockups, every top bar): the colour theme is a three-state segmented switch, `.seg.theme-switch`
 * (Follow system, Light, Dark), icons only, each a toggle button with aria-pressed. It replaces the single toggle button (WP-19/TH-004):
 * the mockup draws the switch, and it can return to "Follow system" from the top bar as well as from Account settings > Appearance.
 * The group keeps the old test hook `theme-toggle`; the buttons are `theme-system`, `theme-light`, `theme-dark`.
 */
const OPTS: Array<[ThemeChoice, string, 'monitor' | 'sun' | 'moon']> = [['system', 'Follow system', 'monitor'], ['light', 'Light', 'sun'], ['dark', 'Dark', 'moon']];

export function ThemeToggle() {
  const theme = useUi((s) => s.theme);
  const setTheme = useUi((s) => s.setTheme);
  const resolved = typeof document !== 'undefined' && document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
  return (
    <div className="seg theme-switch" role="group" aria-label="Colour theme" data-testid="theme-toggle">
      {OPTS.map(([v, label, icon]) => (
        <button key={v} type="button" aria-pressed={theme === v} aria-label={label} data-testid={`theme-${v}`} onClick={() => setTheme(v)}
          title={v === 'system' ? `Follow system (now ${resolved})` : label}><Icon name={icon} size={14} /></button>
      ))}
    </div>
  );
}

/** The three-state choice (System, Light, Dark) for Account settings. */
export function ThemeChoiceControl() {
  const theme = useUi((s) => s.theme);
  const setTheme = useUi((s) => s.setTheme);
  const opts: Array<[ThemeChoice, string]> = [['system', 'Follow the system'], ['light', 'Light'], ['dark', 'Dark']];
  return (
    <div className="v2-seg" role="radiogroup" aria-label="Theme" data-testid="theme-choice">
      {opts.map(([v, l]) => (
        <button key={v} type="button" role="radio" aria-checked={theme === v} className={theme === v ? 'on' : ''} onClick={() => setTheme(v)}>{l}</button>
      ))}
    </div>
  );
}
