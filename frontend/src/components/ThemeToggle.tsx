import { Icon } from './Icon';
import { useUi } from '../store/ui';

/** One button: shows the mode you will switch to. The choice is remembered; until one is made the system setting applies. */
export function ThemeToggle() {
  const theme = useUi((s) => s.theme);
  const setTheme = useUi((s) => s.setTheme);
  const dark = theme === 'dark' || (theme === 'system' && typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches);
  return (
    <button className="icon-btn v2-theme-toggle" onClick={() => setTheme(dark ? 'light' : 'dark')} title={dark ? 'Switch to light mode' : 'Switch to dark mode'}
      aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'} data-testid="theme-toggle">
      <Icon name={dark ? 'sun' : 'moon'} size={17} />
    </button>
  );
}
