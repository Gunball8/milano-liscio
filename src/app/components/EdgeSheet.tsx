import { useEffect, useState } from 'react';
import type { CorrectedSurface } from '../../core/corrections.ts';
import { applyCorrection, restoreOsm, setWholeStreet } from '../corrections/actions.ts';
import { call } from '../routing/client.ts';
import { useApp } from '../store.ts';
import { Icon } from './Icon.tsx';

const CLASS_LABEL = ['Lisse', 'Dalles', 'Pavé', 'Meuble', 'Inconnu'];
const CHOICES: [CorrectedSurface, number, string][] = [
  ['SMOOTH', 0, 'Lisse'],
  ['SLABS', 1, 'Dalles'],
  ['PAVE', 2, 'Pavé'],
];
const m = (v: number) => (v >= 1000 ? `${(v / 1000).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} km` : `${Math.round(v)} m`);
const frDate = (d: string | null) => (d ? new Date(d).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }) : 'date inconnue');

/** Segment sheet (SPEC §9.3): name, OSM tags and date, link, effective state, actions. */
export function EdgeSheet({ panelRef }: { panelRef?: (el: HTMLElement | null) => void }) {
  const e = useApp((s) => s.selectedEdge);
  const street = useApp((s) => s.street);
  const wholeStreet = useApp((s) => s.wholeStreet);
  const [tags, setTags] = useState<[string, string][] | null>(null);
  const [tagsFor, setTagsFor] = useState<number>(-1);
  const edge = e?.edge;
  useEffect(() => {
    setTags(null);
    setTagsFor(-1);
  }, [edge]);
  if (!e) return null;
  const scope = street ?? [e];
  const anyCorrected = scope.some((x) => x.effective.corrected);
  const eff = e.effective;
  return (
    <section className="edge-sheet" aria-label="Tronçon" ref={panelRef}>
      <div className="sheet-head">
        <h2>{e.name ?? 'Tronçon sans nom'}</h2>
        <button type="button" className="icon-button" aria-label="Fermer la fiche" onClick={() => useApp.setState({ selectedEdge: null, street: null })}>
          <Icon name="close" />
        </button>
      </div>
      <p className="note">
        {m(e.length)} · modifié dans OSM le {frDate(e.osmDate)} ·{' '}
        <a href={`https://www.openstreetmap.org/way/${e.wayId}`} target="_blank" rel="noreferrer">
          voir la way {e.wayId}
        </a>
      </p>
      <p className="state-line">
        OSM : {CLASS_LABEL[e.osm.cls]}, rails {e.osm.rail ? 'oui' : 'non'}
        {eff.corrected && (
          <>
            {' '}
            → <strong>{CLASS_LABEL[eff.cls]}, rails {eff.rail ? 'oui' : 'non'}</strong> (corrigé)
          </>
        )}
      </p>
      <label className="switch-row">
        <input type="checkbox" role="switch" checked={wholeStreet} disabled={!e.name} onChange={(ev) => void setWholeStreet(ev.target.checked)} />
        Appliquer à toute la rue{street ? ` (${street.length} tronçons, ${m(street.reduce((s, x) => s + x.length, 0))})` : ''}
      </label>
      <div className="segmented three" role="radiogroup" aria-label="Revêtement">
        {CHOICES.map(([value, code, label]) => (
          <button key={value} type="button" role="radio" aria-checked={eff.cls === code} className={eff.cls === code ? 'seg on' : 'seg'} onClick={() => void applyCorrection({ surface: value })}>
            {label}
          </button>
        ))}
      </div>
      <div className="segmented two" role="radiogroup" aria-label="Rails">
        {[true, false].map((v) => (
          <button key={String(v)} type="button" role="radio" aria-checked={eff.rail === v} className={eff.rail === v ? 'seg on' : 'seg'} onClick={() => void applyCorrection({ rails: v })}>
            Rails {v ? 'oui' : 'non'}
          </button>
        ))}
      </div>
      {anyCorrected && (
        <button type="button" className="button secondary" onClick={() => void restoreOsm()}>
          Rétablir OSM
        </button>
      )}
      <details
        onToggle={(ev) => {
          if ((ev.target as HTMLDetailsElement).open && tagsFor !== e.edge) {
            setTagsFor(e.edge);
            void call({ type: 'tags', edge: e.edge }).then(setTags);
          }
        }}
      >
        <summary>Tags OSM</summary>
        {tags ? (
          <dl className="tags">
            {tags.map(([k, v]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="note">Chargement…</p>
        )}
      </details>
    </section>
  );
}
