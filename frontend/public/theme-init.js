// Apply the saved theme before first paint so there is no light flash in dark mode.
// A file rather than an inline <script>: the Content-Security-Policy allows no inline script (audit ENT-012 / FE-017).
// Two themes only (owner rule 2026-11-28). Order: the person's own choice, then the organisation default cached at the last sign-in
// (agastya.theme.default, audit TH-008), then light. The OS setting is not followed.
try { var t = localStorage.getItem('agastya.theme'); if (t !== 'light' && t !== 'dark') t = localStorage.getItem('agastya.theme.default'); document.documentElement.dataset.theme = t === 'dark' ? 'dark' : 'light'; } catch (e) { document.documentElement.dataset.theme = 'light'; }
