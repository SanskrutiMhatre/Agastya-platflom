// UI redesign step 1: two places of the project shell a page can fill, as the mockups draw them (project.html, publication.html,
// validation.html): the page's own actions at the right of the top bar ("Validate", "Open editor", "Build PDF") and the items of the status
// bar ("14 errors", "Pages 1-2 of 142", "Run 31 · 12 s"). A page renders <TopbarActions> / <StatusItems> anywhere in its tree; the content is
// portalled into the shell. Outside the project shell (or on the editor page, which has its own header and status bar) nothing is drawn.
//
//   <TopbarActions><button className="btn">Validate</button><button className="btn primary">Open editor</button></TopbarActions>
//   <StatusItems><span className="item"><span className="dot danger" />14 errors</span><span className="grow" /><span className="item">Run 31</span></StatusItems>

import { createContext, useContext, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export interface ShellSlots { actions: HTMLElement | null; status: HTMLElement | null }
export const ShellSlotsContext = createContext<ShellSlots>({ actions: null, status: null });

export function TopbarActions({ children }: { children: ReactNode }) {
  const el = useContext(ShellSlotsContext).actions;
  return el ? createPortal(children, el) : null;
}

/** The page's status items replace the shell's default ones (format, data module count) while the page is shown. */
export function StatusItems({ children }: { children: ReactNode }) {
  const el = useContext(ShellSlotsContext).status;
  return el ? createPortal(children, el) : null;
}
