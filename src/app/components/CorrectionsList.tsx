import { useRef, useState } from 'react';
import type { CorrectionRecord } from '../../core/corrections.ts';
import { deleteReport, exportBackup, exportGeojson, focusCorrection, focusReport, importBackup, markReportDone, removeCorrections } from '../corrections/actions.ts';
import { useApp } from '../store.ts';

const SURFACE_LABEL = { SMOOTH: 'Lisse', SLABS: 'Dalles', PAVE: 'Pavé' } as const;
const STATE_LABEL = { ok: null, orphan: 'orpheline', obsolete: 'obsolète' } as const;
/** One line per user action: a whole-street correction creates one record per segment, shown together. */
export function groups(list: CorrectionRecord[]): CorrectionRecord[][] {
  const out: CorrectionRecord[][] = [];
  for (const c of [...list].sort((a, b) => b.createdAt - a.createdAt)) {
    const g = out[out.length - 1];
    const head = g?.[0];
    if (head && head.name === c.name && head.surface === c.surface && head.rails === c.rails && Math.abs(head.createdAt - c.createdAt) < 2000) g.push(c);
    else out.push([c]);
  }
  return out;
}

const when = (t: number) => new Date(t).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

/** Corrections and reports to sort, backup and export (SPEC §9.3). */
export function CorrectionsList() {
  const corrections = useApp((s) => s.corrections);
  const status = useApp((s) => s.correctionStatus);
  const reports = useApp((s) => s.reports);
  const [tab, setTab] = useState<'corrections' | 'reports'>('corrections');
  const file = useRef<HTMLInputElement>(null);
  const close = () => useApp.setState({ sheet: 'none' });
  const todo = reports.filter((r) => r.status === 'todo');

  return (
    <div className="sheet-backdrop" onClick={close}>
      <section className="sheet tall" role="dialog" aria-label="Liste des corrections" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <h2>Liste</h2>
          <button type="button" className="icon-button" onClick={close} aria-label="Fermer">
            ×
          </button>
        </div>
        <div className="segmented two" role="tablist">
          <button type="button" role="tab" aria-selected={tab === 'corrections'} className={tab === 'corrections' ? 'seg on' : 'seg'} onClick={() => setTab('corrections')}>
            Corrections ({groups(corrections).length})
          </button>
          <button type="button" role="tab" aria-selected={tab === 'reports'} className={tab === 'reports' ? 'seg on' : 'seg'} onClick={() => setTab('reports')}>
            À trier ({todo.length})
          </button>
        </div>

        {tab === 'corrections' ? (
          <ul className="results" aria-label="Corrections">
            {corrections.length === 0 && <li className="note pad">Aucune correction.</li>}
            {groups(corrections).map((g) => {
              const c = g[0]!;
              const states = new Set(g.map((x) => status[x.id]?.state ?? 'orphan'));
              const st = states.has('orphan') ? 'orphan' : states.has('obsolete') ? 'obsolete' : 'ok';
              const label = STATE_LABEL[st];
              const meters = g.reduce((s, x) => s + x.length, 0);
              return (
                <li key={c.id}>
                  <button type="button" className="result" onClick={() => void focusCorrection(c)}>
                    <span className="result-label">
                      {c.name ?? 'Sans nom'} {label && <span className={`pill ${st}`}>{label}</span>}
                    </span>
                    <span className="result-sub">
                      {[c.surface && SURFACE_LABEL[c.surface], c.rails !== undefined && `rails ${c.rails ? 'oui' : 'non'}`].filter(Boolean).join(' · ')}
                      {g.length > 1 ? ` · ${g.length} tronçons, ${Math.round(meters)} m` : ''} · {when(c.createdAt)}
                    </span>
                  </button>
                  <button type="button" className="icon-button" aria-label={`Supprimer la correction ${c.name ?? ''}`} onClick={() => void removeCorrections(g.map((x) => x.id))}>
                    ×
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <ul className="results" aria-label="Signalements">
            {todo.length === 0 && <li className="note pad">Aucun signalement à trier.</li>}
            {todo.map((r) => (
              <li key={r.id}>
                <button type="button" className="result" onClick={() => void focusReport(r)}>
                  <span className="result-label">Signalement du {when(r.at)}</span>
                  <span className="result-sub">{r.accuracy != null ? `précision ±${Math.round(r.accuracy)} m` : 'précision inconnue'}</span>
                </button>
                <button type="button" className="text-button" onClick={() => void markReportDone(r)}>
                  Trié
                </button>
                <button type="button" className="icon-button" aria-label="Supprimer le signalement" onClick={() => void deleteReport(r.id)}>
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}

        <h3>Sauvegarde</h3>
        <div className="stack">
          <button type="button" className="button secondary" onClick={() => void exportBackup()}>
            Exporter la sauvegarde (JSON)
          </button>
          <button type="button" className="button secondary" onClick={() => file.current?.click()}>
            Importer une sauvegarde
          </button>
          <input
            ref={file}
            type="file"
            accept="application/json,.json"
            hidden
            aria-label="Fichier de sauvegarde"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void importBackup(f);
              e.target.value = '';
            }}
          />
          <button type="button" className="button secondary" onClick={() => void exportGeojson()} disabled={corrections.length === 0}>
            Exporter pour OSM (GeoJSON)
          </button>
        </div>
      </section>
    </div>
  );
}
