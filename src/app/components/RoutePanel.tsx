import { useRef } from 'react';
import { clearRoute, computeRoute, selectAlternative } from '../routing/actions.ts';
import { startTracking } from '../tracking/session.ts';
import { useApp } from '../store.ts';
import { usePanelHeight } from '../usePanelHeight.ts';
import { LevelSelector } from './LevelSelector.tsx';

const m = (v: number) => (v >= 1000 ? `${(v / 1000).toLocaleString('fr-FR', { maximumFractionDigits: 2, minimumFractionDigits: 1 })} km` : `${Math.round(v)} m`);
const min = (s: number) => `${Math.max(1, Math.round(s / 60))} min`;
const signed = (v: number) => `${v >= 0 ? '+' : '−'}${Math.abs(Math.round(v)).toLocaleString('fr-FR')} m`;
const pct = (v: number) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toLocaleString('fr-FR', { maximumFractionDigits: 0 })} %`;

/** Bottom panel (SPEC §9.1): selector, stats of the selected alternative, the three alternatives. */
export function RoutePanel() {
  const to = useApp((s) => s.to);
  const routes = useApp((s) => s.routes);
  const selected = useApp((s) => s.selected);
  const status = useApp((s) => s.routeStatus);
  const error = useApp((s) => s.routeError);
  const engine = useApp((s) => s.engine);
  const panel = useRef<HTMLElement>(null);
  usePanelHeight(panel);

  if (!to) {
    return (
      <section className="route-panel compact" ref={panel}>
        <p className="note">Chercher une arrivée, ou appui long sur la carte pour choisir un point.</p>
      </section>
    );
  }

  const r = routes?.find((x) => x.level === selected) ?? routes?.[0];
  return (
    <section className="route-panel" aria-label="Itinéraire" ref={panel}>
      <LevelSelector />
      {(status === 'locating' || status === 'computing' || engine === 'loading') && (
        <p className="note" aria-live="polite">
          {status === 'locating' ? 'Localisation…' : "Calcul de l'itinéraire…"}
        </p>
      )}
      {status === 'error' && (
        <div className="route-error" role="alert">
          <p>{error}</p>
          <div className="row">
            <button type="button" className="button secondary" onClick={() => void computeRoute()}>
              Réessayer
            </button>
            <button type="button" className="button secondary" onClick={clearRoute}>
              Effacer
            </button>
          </div>
        </div>
      )}
      {r && status !== 'error' && (
        <>
          <div className="route-summary">
            <strong className="big">{m(r.stats.distance)}</strong>
            <span>{min(r.stats.duration)}</span>
            <span className="delta">{r.level === 0 ? 'le plus court' : `${signed(r.deltaM)} (${pct(r.deltaPct)}) vs le plus court`}</span>
            <button type="button" className="icon-button close" aria-label="Effacer l'itinéraire" onClick={clearRoute}>
              ×
            </button>
          </div>
          <dl className="route-stats">
            <div>
              <dt>Pavé</dt>
              <dd className={r.stats.paveM > 0 ? 'pave' : ''}>{m(r.stats.paveM)}</dd>
            </div>
            <div>
              <dt>Le long de rails</dt>
              <dd>{m(r.stats.railM)}</dd>
            </div>
            <div>
              <dt>Croisements</dt>
              <dd>{r.stats.crossings}</dd>
            </div>
            <div>
              <dt>À pied</dt>
              <dd>{m(r.stats.pushM)}</dd>
            </div>
          </dl>
          <div className="alternatives" role="radiogroup" aria-label="Alternatives">
            {routes!.map((x) => (
              <button
                key={x.level}
                type="button"
                role="radio"
                aria-checked={x.level === selected}
                aria-label={`${x.label} : ${m(x.stats.distance)}, ${m(x.stats.paveM)} de pavé`}
                className={x.level === selected ? 'alt on' : 'alt'}
                onClick={() => selectAlternative(x.level)}
              >
                <span className="alt-name">{x.label}</span>
                <span className="alt-figures">
                  {m(x.stats.distance)} · <span className={x.stats.paveM > 0 ? 'alt-pave' : 'alt-pave none'}>{m(x.stats.paveM)}</span>
                </span>
              </button>
            ))}
          </div>
          <button type="button" className="button start" onClick={() => void startTracking()}>
            Démarrer
          </button>
        </>
      )}
    </section>
  );
}
