'use client';
import { useCallback, useRef } from 'react';

// On narrow screens tables with the class "stack-table" show each row as a card (globals.css).
// Each cell gets its column heading as data-label, kept in sync as rows change.
export function useStackTable<T extends HTMLTableElement>() {
  const observer = useRef<MutationObserver | null>(null);
  return useCallback((table: T | null) => {
    observer.current?.disconnect();
    observer.current = null;
    if (!table) return;
    const label = () => {
      const headings = [...table.querySelectorAll('thead th')].map(th => th.textContent?.trim() || '');
      for (const row of table.querySelectorAll('tbody tr')) {
        [...row.children].forEach((cell, index) => { if (headings[index] && cell.getAttribute('data-label') !== headings[index]) cell.setAttribute('data-label', headings[index]); });
      }
    };
    label();
    observer.current = new MutationObserver(label);
    observer.current.observe(table, { childList: true, subtree: true, characterData: true });
  }, []);
}
