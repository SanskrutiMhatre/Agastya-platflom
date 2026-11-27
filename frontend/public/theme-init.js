// Apply the saved theme before first paint so there is no light flash in dark mode.
// A file rather than an inline <script>: the Content-Security-Policy allows no inline script (audit ENT-012 / FE-017).
try { var t = localStorage.getItem('agastya.theme'); if (t === 'dark' || (t !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches)) document.documentElement.dataset.theme = 'dark'; } catch (e) {}
