import { Icon } from './Icon';
import { useUi, type ThemeChoice } from '../store/ui';

const isDark = (theme: ThemeChoice): boolean => theme === 'dark' || (theme === 'system' && document.documentElement.dataset.theme === 'dark');

/** One button: shows the mode you will switch to. The choice is remembered; Account settings > Appearance can return to "Follow the system" (TH-004). */
export function ThemeToggle() {
  const theme = useUi((s) => s.theme);
  const setTheme = useUi((s) => s.setTheme);
  const dark = typeof document !== 'undefined' && isDark(theme);
  const now = theme === 'system' ? `following the system (${dark ? 'dark' : 'light'})` : dark ? 'dark' : 'light';
  const label = dark ? 'Switch to light mode' : 'Switch to dark mode';
  return (
    <button className="icon-btn v2-theme-toggle" onClick={() => setTheme(dark ? 'light' : 'dark')} title={`${label} (now ${now})`}
      aria-label={label} data-testid="theme-toggle">
      <Icon name={dark ? 'sun' : 'moon'} size={17} />
    </button>
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
