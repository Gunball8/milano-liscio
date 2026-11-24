import { type RefObject, useEffect } from 'react';

/**
 * Publishes the height of the bottom element of the current screen as --panel-h, so map controls
 * (attribution) and route framing stay clear of it. Every mode sets it; 0 when nothing is at the bottom.
 */
export function usePanelHeight(ref: RefObject<HTMLElement | null>, extra = 0) {
  useEffect(() => {
    const el = ref.current;
    const setH = (h: number) => document.documentElement.style.setProperty('--panel-h', `${h}px`);
    if (!el) {
      setH(0);
      return;
    }
    const ro = new ResizeObserver(() => setH(el.offsetHeight + extra));
    ro.observe(el);
    return () => ro.disconnect();
  });
}
