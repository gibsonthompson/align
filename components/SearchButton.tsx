'use client';

import { Search } from 'lucide-react';

export const OPEN_SWITCHER = 'align:open-switcher';

export function openSwitcher() {
  window.dispatchEvent(new CustomEvent(OPEN_SWITCHER));
}

// Opens the quick switcher. Cmd+K or Ctrl+K does the same from anywhere.
export default function SearchButton() {
  return (
    <button type="button" className="search-trigger" onClick={openSwitcher} aria-label="Search everything">
      <Search size={18} strokeWidth={2.5} />
      <span className="label">Jump To</span>
      <kbd>⌘K</kbd>
    </button>
  );
}
