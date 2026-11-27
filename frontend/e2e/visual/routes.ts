// WP-20: the screens the theme and accessibility suite visits. `named` marks the ten routes of gate G-UX-1 (12-ENTERPRISE-READINESS section 8:
// sign-in, workspace, project, Studio, JSS editor, JSG editor, Publish, Release, Admin, Settings); the others are extra key screens of the
// screenshot set (11 section 10.8).
import { expect, type Page } from '@playwright/test';
import type { Seed } from './seed';

export interface Screen {
  name: string;
  named: boolean;
  as: 'author' | 'admin' | 'nobody';
  url: (s: Seed) => string;
  ready: (p: Page) => Promise<void>;
}

const heading = async (p: Page) => { await expect(p.getByRole('heading').first()).toBeVisible({ timeout: 30_000 }); };

export const SCREENS: Screen[] = [
  { name: 'sign-in', named: true, as: 'nobody', url: () => '/', ready: async (p) => { await expect(p.getByRole('button', { name: 'Sign in' })).toBeVisible(); } },
  { name: 'overview', named: false, as: 'author', url: () => '/overview', ready: heading },
  { name: 'workspace', named: true, as: 'author', url: () => '/workspace', ready: heading },
  { name: 'projects', named: false, as: 'author', url: () => '/projects', ready: async (p) => { await expect(p.getByRole('button', { name: /New project/ })).toBeVisible(); } },
  { name: 'project', named: true, as: 'author', url: (s) => `/projects/${s.ids.s1000d}`, ready: heading },
  { name: 'studio', named: true, as: 'author', url: (s) => `/projects/${s.ids.s1000d}/editor`, ready: async (p) => { await expect(p.getByTestId('save-state')).toBeVisible({ timeout: 60_000 }); } },
  { name: 'jss-editor', named: true, as: 'author', url: (s) => `/projects/${s.ids.jss}/editor`, ready: async (p) => { await expect(p.getByTestId('jss-editor')).toBeVisible({ timeout: 30_000 }); } },
  { name: 'jsg-editor', named: true, as: 'author', url: (s) => `/projects/${s.ids.jsg}/editor`, ready: async (p) => { await expect(p.getByTestId('jsg-generate')).toBeVisible({ timeout: 30_000 }); } },
  { name: 'publication', named: true, as: 'author', url: (s) => `/projects/${s.ids.s1000d}/publication`, ready: heading },
  { name: 'validation', named: false, as: 'author', url: (s) => `/projects/${s.ids.s1000d}/validation`, ready: heading },
  { name: 'release', named: true, as: 'author', url: (s) => `/projects/${s.ids.s1000d}/release`, ready: heading },
  { name: 'administrator', named: true, as: 'admin', url: () => '/administrator', ready: heading },
  { name: 'settings', named: true, as: 'author', url: () => '/settings', ready: heading },
];
