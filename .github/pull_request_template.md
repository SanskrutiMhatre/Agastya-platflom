## What and why

<!-- One paragraph: what changes for the user, and the audit finding or owner request it answers. -->

## Feature preservation (WP-34)

- [ ] `npm run check:parity` passes; every removed route, rail item, command, key, test id or test has a row in `docs/audit/baseline/parity-explanations.json`
- [ ] Nothing a user can do today is lost (the owner's first rule); a control that moved names its new home in `docs/audit/baseline/CHECKLIST.md`

## Removal checklist (WP-36, CLN-004) - fill in when a screen, control or feature is removed

When something leaves the screens, remove everything that only it used, in the same change:

- [ ] client route (a `<Route>`; an old address that people may have bookmarked becomes a redirect, listed in the parity check's `removedByOwner`)
- [ ] rail item, menu entry, button, label and help text
- [ ] API client wrapper in `frontend/src/api/*` and its types
- [ ] server route and its tests, **or** the route kept on purpose and listed with its reason in `docs/API-ONLY-ROUTES.md`
- [ ] helpers, permission checks and stores that only it used
- [ ] CSS rules and classes
- [ ] `data-testid` values, and a browser test that guards the absence of the removed control
- [ ] documentation lines (README, `docs/`)
- [ ] an entry in `frontend/scripts/cleanup/removed-features.json` (its files, identifiers, strings, class prefixes, rail labels, kept routes) so the debris cannot come back
- [ ] `npm run lint` passes: no frontend file, export or CSS class that nothing references outside `frontend/scripts/cleanup/allowlist.json` (an allow-list entry needs a reason), and no debris of a removed feature

## Tests run

<!-- The commands and their results; say what was not run and why. -->
