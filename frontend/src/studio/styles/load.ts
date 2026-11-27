// WP-18 (FE-020): the Studio shell and document stylesheets load with the Studio editor chunk instead of the entry.
// They are linked AHEAD of the entry stylesheets, so the cascade is the one the app always had (tokens, Studio sheets,
// platform.css, pdf.css, states.css): the platform and state sheets were written to override Studio rules of equal
// specificity by coming later, and a plain `import './app.css'` in the lazy chunk would append them after the entry and
// reverse that. The app-wide head of the old app.css (resets, buttons, fields, modal dialogs) is styles/base.css, in the entry.
import appCss from './app.css?url';
import documentCss from './document.css?url';

let loading: Promise<void> | null = null;

/** Links the Studio stylesheets once and resolves when they have loaded (or failed: the editor still works unstyled). */
export function loadStudioStyles(): Promise<void> {
  if (loading) return loading;
  const head = document.head;
  // the first stylesheet of the page is the entry's (a <link> in a build, the dev server's <style> tags in development)
  const first = head.querySelector('link[rel="stylesheet"], style');
  loading = Promise.all([appCss, documentCss].map((href) => new Promise<void>((resolve) => {
    const link = document.createElement('link');
    link.rel = 'stylesheet'; link.href = href; link.dataset.studioStyles = '';
    link.onload = () => resolve(); link.onerror = () => resolve();
    head.insertBefore(link, first);
  }))).then(() => undefined);
  return loading;
}
