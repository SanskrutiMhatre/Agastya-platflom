// The account button of the top bars (UI redesign step 1; mockups: an icon-only "Account" button at the right end of every top bar).
// Owner rule (e2e 00-platform): the button is an icon, and the menu names neither the person nor the username, only the role.
// WP-23 (UX-005 d): it behaves as a menu: opening it puts focus on the first item, Up/Down/Home/End move between the items, Escape closes it
// and returns focus to the button, Tab closes it and moves on. Down on the closed button opens it.

import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from './Icon';
import { useSession } from '../store/session';
import { globalLabel } from '../lib/roles';

/** `railPin`: inside a project, the menu also holds the rail's "names beside the icons" switch (the mockups' rail has no pin button). */
export function AccountMenu({ railPin }: { railPin?: { pinned: boolean; toggle: () => void } } = {}) {
  const user = useSession((s) => s.user);
  const logout = useSession((s) => s.logout);
  const nav = useNavigate();
  const [menu, setMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const close = (e: MouseEvent) => { if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenu(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);
  const menuItems = () => Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"], [role="menuitemcheckbox"]') ?? []);
  useEffect(() => { if (menu) menuItems()[0]?.focus(); }, [menu]);
  const menuKeys = (e: ReactKeyboardEvent) => {
    if (!menu) { if (e.key === 'ArrowDown' && e.target === menuButton.current) { e.preventDefault(); setMenu(true); } return; }
    const list = menuItems();
    const at = list.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'Escape') { e.preventDefault(); setMenu(false); menuButton.current?.focus(); }
    else if (e.key === 'Tab') setMenu(false);
    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); list[(at + (e.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length]?.focus(); }
    else if (e.key === 'Home' || e.key === 'End') { e.preventDefault(); list[e.key === 'Home' ? 0 : list.length - 1]?.focus(); }
  };
  return (
    <div ref={menuRef} className="v2-pop-anchor" onKeyDown={menuKeys}>
      <button ref={menuButton} className="icon-btn" onClick={() => setMenu((m) => !m)} aria-haspopup="menu" aria-expanded={menu} aria-label="Account menu" title="Account" data-testid="account-menu">
        <Icon name="user" size={20} />
      </button>
      {menu ? (
        <div className="menu v2-acct-menu" role="menu" aria-label="Account">
          <div className="v2-acct-who"><span className="faint">Signed in as</span><strong>{globalLabel(user?.role)}</strong></div>
          <button className="item" role="menuitem" tabIndex={-1} onClick={() => { setMenu(false); nav('/settings'); }}><Icon name="settings" />Account settings</button>
          {railPin ? <button className="item" role="menuitemcheckbox" aria-checked={railPin.pinned} tabIndex={-1} data-testid="rail-pin" onClick={() => { setMenu(false); railPin.toggle(); }}>
            <Icon name={railPin.pinned ? 'collapse' : 'panel'} />{railPin.pinned ? 'Show the project icons only' : 'Show names beside the project icons'}</button> : null}
          <div className="sep" role="separator" />
          <button className="item" role="menuitem" tabIndex={-1} onClick={() => void logout()}><Icon name="logout" />Sign out</button>
        </div>
      ) : null}
    </div>
  );
}
