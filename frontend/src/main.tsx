import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider, createBrowserRouter } from 'react-router-dom';
import './studio/styles/app.css';
import './studio/styles/document.css';
import './styles/platform.css';
import './styles/pdf.css';
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
