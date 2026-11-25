import { useCallback, useEffect, useState } from 'react';

/**
 * Publishes the height of the bottom element of the current screen as --panel-h, so map controls
 * (attribution, locate button, toasts) and route framing stay clear of it. Returns a callback ref: the
 * observer is created when the element changes, not at every render (the tracking banner re-renders
 * at each GPS fix).
 */
export function usePanelHeight<T extends HTMLElement>(extra = 0): (el: T | null) => void {
  const [el, setEl] = useState<T | null>(null);
  useEffect(() => {
    const setH = (h: number) => document.documentElement.style.setProperty('--panel-h', `${h}px`);
    if (!el) return;
    const ro = new ResizeObserver(() => setH(el.offsetHeight + extra));
    ro.observe(el);
    return () => ro.disconnect();
  }, [el, extra]);
  return useCallback((node: T | null) => setEl(node), []);
}
