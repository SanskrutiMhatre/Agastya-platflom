import type { Config } from 'tailwindcss';

// The platform shares the Studio's design tokens (CSS variables on :root, flipped by
// html[data-theme='dark']), so the shell and the embedded editor are one visual system
// and one dark-mode switch. Tailwind supplies layout utilities only: preflight is off
// because the Studio ships its own element resets and a second reset would fight it.
const config: Config = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  corePlugins: { preflight: false },
  theme: {
    extend: {
      colors: {
        bg: 'var(--bg)', elev: 'var(--bg-elev)', sunken: 'var(--bg-sunken)', hover: 'var(--bg-hover)',
        line: 'var(--border)', ink: 'var(--text)', muted: 'var(--text-muted)', faint: 'var(--text-faint)',
        accent: 'var(--accent)', 'accent-soft': 'var(--accent-soft)',
        danger: 'var(--danger)', 'danger-soft': 'var(--danger-soft)',
        warn: 'var(--warning)', 'warn-soft': 'var(--warning-soft)',
        ok: 'var(--success)', 'ok-soft': 'var(--success-soft)',
      },
      fontFamily: { mono: ['JetBrains Mono', 'Cascadia Code', 'Consolas', 'ui-monospace', 'monospace'] },
    },
  },
  plugins: [],
};

export default config;
