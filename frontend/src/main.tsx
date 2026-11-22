import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import './studio/styles/app.css';
import './studio/styles/document.css';
import './styles/platform.css';
import './styles/pdf.css';
import { App } from './App';
import { applyTheme, useUi } from './store/ui';

applyTheme(useUi.getState().theme);
// Follow the OS when the user has not chosen a theme explicitly.
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (useUi.getState().theme === 'system') applyTheme('system'); });

createRoot(document.getElementById('root')!).render(
  <StrictMode><BrowserRouter><App /></BrowserRouter></StrictMode>,
);
