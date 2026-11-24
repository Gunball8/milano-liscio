import { type RefObject, useRef } from 'react';
import { exitCorrections } from '../corrections/actions.ts';
import { useApp } from '../store.ts';
import { usePanelHeight } from '../usePanelHeight.ts';
import { groups } from './CorrectionsList.tsx';
import { EdgeSheet } from './EdgeSheet.tsx';

/** Corrections screen (SPEC §9.3): surface layer on, tap a street to open its sheet. */
export function CorrectionsScreen() {
  const corrections = useApp((s) => s.corrections);
  const todo = useApp((s) => s.reports.filter((r) => r.status === 'todo').length);
  const count = groups(corrections).length + todo;
  const zoomOk = useApp((s) => s.surfaceZoomOk);
  const selected = useApp((s) => !!s.selectedEdge);
  const bottom = useRef<HTMLElement>(null);
  usePanelHeight(bottom, 20);
  return (
    <>
      <header className="corrections-bar">
        <div>
          <strong>Corrections</strong>
          <p className="note">{zoomOk ? 'Toucher une rue pour la corriger.' : 'Zoomer pour voir les revêtements.'}</p>
        </div>
        <button type="button" className="chip" onClick={() => useApp.setState({ sheet: 'list' })}>
          Liste{count > 0 ? ` (${count})` : ''}
        </button>
        <button type="button" className="chip" onClick={exitCorrections}>
          Terminer
        </button>
      </header>
      {selected ? (
        <EdgeSheet panelRef={bottom} />
      ) : (
        <div className="legend-bar" aria-label="Légende" ref={bottom as RefObject<HTMLDivElement>}>
          <span>
            <i style={{ borderColor: '#d6336c' }} />
            pavé
          </span>
          <span>
            <i style={{ borderColor: '#f08c00' }} />
            dalles
          </span>
          <span>
            <i style={{ borderColor: '#8b5cf6' }} />
            rails
          </span>
          <span>
            <i className="dashed" style={{ borderColor: '#868e96' }} />
            inconnu
          </span>
        </div>
      )}
    </>
  );
}
