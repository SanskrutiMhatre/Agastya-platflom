# Routes and the project rail (baseline)

Captured 2026-11-27 from `frontend/src/App.tsx` and `frontend/src/layouts/ProjectShell.tsx`, before any Phase 2 change. Phase 2 must keep every destination reachable (it may move it) and every rail item per project kind.

## Application routes (`App.tsx`)

| Line | Declaration |
|---|---|
| 56 | `<Route element={<AppShell />}>` |
| 57 | `<Route index element={<Navigate to="/overview" replace />} />` |
| 58 | `<Route path="overview" element={<Overview />} />` |
| 59 | `<Route path="workspace" element={<Workspace />} />` |
| 60 | `<Route path="projects" element={<Projects />} />` |
| 61 | `{canMonitor(user) ? <Route path="activity" element={<Activity />} /> : null}` |
| 62 | `<Route path="notifications" element={<Notifications />} />` |
| 63 | `<Route path="graphics" element={<GraphicsPage />} />` |
| 64 | `<Route path="cir" element={<CirPage />} />` |
| 65 | `<Route path="backup" element={<BackupPage />} />` |
| 66 | `{user?.role === 'admin' ? <Route path="administrator/*" element={<AdministratorPage />} /> : null}` |
| 67 | `<Route path="settings/*" element={<Settings />} />` |
| 69 | `<Route path="preview/:id/:mode" element={<PreviewWindow />} />` |
| 70 | `<Route path="projects/:id" element={<ProjectShell />}>` |
| 71 | `<Route index element={<Navigate to="editor" replace />} />` |
| 72 | `<Route path="editor" element={<EditorRoute />} />` |
| 73 | `<Route path="explore" element={<ExploreRoute />} />` |
| 74 | `<Route path="publication" element={<PublicationRoute />} />` |
| 75 | `<Route path="validation" element={<ValidationPage />} />` |
| 76 | `<Route path="graphics" element={<ProjectGraphicsPage />} />` |
| 77 | `<Route path="ancillary" element={<AncillaryRoute />} />` |
| 78 | `<Route path="release" element={<ReleasePage />} />` |
| 79 | `<Route path="csdb" element={<Navigate to="../editor" replace />} />   {/* the Files (CSDB) page was removed; an old link lands in the editor */}` |
| 80 | `<Route path="settings/*" element={<ProjectSettingsPage />} />` |
| 82 | `<Route path="*" element={<Navigate to="/overview" replace />} />` |

## Project rail items (`ProjectShell.tsx`)

Which items a project shows, by kind (read from the conditions in the source):

| Item | S1000D | JSS | JSG | CIR repository project |
|---|---|---|---|---|
| Editor | yes | yes | yes | yes |
| Explore | yes (S1000D page) | yes (`DocExplorePage`) | yes (`DocExplorePage`) | no |
| Publication | yes (S1000D page) | yes (`DocPublicationPage`) | yes (`DocPublicationPage`) | no |
| Graphics | yes | yes | yes | yes |
| Ancillary pages | no | yes | yes | no |
| Validation (badge: error count) | yes | no | no | no |
| Release (badge: pending / R<n>) | yes | yes | yes | no |
| Settings | yes | yes | yes | no |

Source lines:

```
 49  { to: `/projects/${id}/editor`, label: 'Editor', icon: 'editor' },
 50  { to: `/projects/${id}/graphics`, label: 'Graphics', icon: 'image' },
 52  { to: `/projects/${id}/editor`, label: 'Editor', icon: 'editor' },
 53  { to: `/projects/${id}/explore`, label: 'Explore', icon: 'explore' },
 54  { to: `/projects/${id}/publication`, label: 'Publication', icon: 'book' },
 55  { to: `/projects/${id}/graphics`, label: 'Graphics', icon: 'image' },
 56  ...(jssDoc || jsg ? [{ to: `/projects/${id}/ancillary`, label: 'Ancillary pages', icon: 'file' as const }] : []),
 58  { to: `/projects/${id}/validation`, label: 'Validation', icon: 'shield' as const, badge: v && v.error > 0 ? { text: String(v.error), tone: 'bad' as co…
 60  { to: `/projects/${id}/release`, label: 'Release', icon: 'rocket', badge: rel?.pending ? { text: '!', tone: 'warn' } : rel?.released ? { text: `R${rel…
 61  { to: `/projects/${id}/settings`, label: 'Settings', icon: 'settings' },
```
