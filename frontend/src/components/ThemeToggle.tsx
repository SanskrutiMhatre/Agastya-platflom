import { Icon } from './Icon';
import { useUi, type ThemeChoice } from '../store/ui';

/**
 * The colour theme in every top bar (owner rule 2026-11-28): two themes only, light and dark, and ONE icon button that switches between
 * them. The button shows the icon of the theme it switches TO (a moon in light, a sun in dark) and says so in its name. It is the
 * mockups' `.icon-btn` with its name as the hint (title, shown to keyboard users by FocusTooltip). Test hook: `theme-toggle` (the old three-state switch's buttons theme-system/-light/-dark
 * are gone; see docs/audit/baseline/parity-explanations.json).
 */
export function ThemeToggle() {
  const theme = useUi((s) => s.theme);
  const setTheme = useUi((s) => s.setTheme);
  const next: ThemeChoice = theme === 'dark' ? 'light' : 'dark';
  const label = next === 'dark' ? 'Switch to dark theme' : 'Switch to light theme';
  return (
    <button type="button" className="icon-btn theme-switch" data-testid="theme-toggle" aria-label={label} title={label} onClick={() => setTheme(next)}>
      <Icon name={next === 'dark' ? 'moon' : 'sun'} size={16} />
    </button>
  );
}

/** The two-state choice (Light, Dark) for Account settings > Appearance. */
export function ThemeChoiceControl() {
  const theme = useUi((s) => s.theme);
  const setTheme = useUi((s) => s.setTheme);
  const opts: Array<[ThemeChoice, string]> = [['light', 'Light'], ['dark', 'Dark']];
  return (
    <div className="v2-seg" role="radiogroup" aria-label="Theme" data-testid="theme-choice">
      {opts.map(([v, l]) => (
        <button key={v} type="button" role="radio" aria-checked={theme === v} className={theme === v ? 'on' : ''} onClick={() => setTheme(v)}>{l}</button>
      ))}
    </div>
  );
}
