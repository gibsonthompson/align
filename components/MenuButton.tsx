'use client';

import { Menu, Search } from 'lucide-react';
import { TOGGLE_SIDEBAR } from '@/components/Sidebar';
import { openSwitcher } from '@/components/SearchButton';

// Smaller screens only: opens the sidebar drawer and the switcher.
export default function MenuButton() {
  return (
    <span className="menu-btn" style={{ gap: 6, flex: 'none' }}>
      <button type="button" className="btn icon ghost" aria-label="Open navigation" onClick={() => window.dispatchEvent(new CustomEvent(TOGGLE_SIDEBAR))}>
        <Menu size={17} />
      </button>
      <button type="button" className="btn icon ghost" aria-label="Jump to any page" onClick={openSwitcher}>
        <Search size={16} />
      </button>
    </span>
  );
}
