import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider, createBrowserRouter } from 'react-router-dom';
import './styles/tokens/tokens.css';
// The Studio shell and document sheets (studio/styles/app.css, document.css) load with the Studio editor chunk, linked
// ahead of these (studio/styles/load.ts); base.css is the app-wide part they used to carry.
import './styles/base.css';
import './styles/components.css';      // UI redesign step 1: the mockup components (docs/audit/mockups/components.css)
import './styles/platform.css';
import './styles/states.css';
import { App } from './App';
import { applyTheme, useUi } from './store/ui';

applyTheme(useUi.getState().theme);
// Follow the OS when the user has not chosen a theme explicitly.
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (useUi.getState().theme === 'system') applyTheme('system'); });

// A data router (not <BrowserRouter>): only it can hold a page back while it has unsaved work (lib/leaveGuard.tsx). The app's own <Routes> live inside the one splat route.
const router = createBrowserRouter([{ path: '*', element: <App /> }]);

createRoot(document.getElementById('root')!).render(
  <StrictMode><RouterProvider router={router} /></StrictMode>,
);
