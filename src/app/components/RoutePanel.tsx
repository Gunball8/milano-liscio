import { useRef } from 'react';
import type { SegmentView } from '../../worker/protocol.ts';
import { LEVELS } from '../../core/cost.ts';
import { clearRoute, computeRoute, setLevel } from '../routing/actions.ts';
import { startTracking } from '../tracking/session.ts';
import { useApp } from '../store.ts';
import { usePanelHeight } from '../usePanelHeight.ts';
import { Icon } from './Icon.tsx';

const m = (v: number) => (v >= 1000 ? `${(v / 1000).toLocaleString('fr-FR', { maximumFractionDigits: 2, minimumFractionDigits: 1 })} km` : `${Math.round(v)} m`);
const min = (s: number) => `${Math.max(1, Math.round(s / 60))} min`;
const signed = (v: number) => `${v >= 0 ? '+' : '−'}${Math.abs(Math.round(v)).toLocaleString('fr-FR')} m`;
const pct = (v: number) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toLocaleString('fr-FR', { maximumFractionDigits: 0 })} %`;
const CLS = ['smooth', 'slabs', 'pave', 'loose', 'unknown'];

/** The route from start to end as a coloured ribbon: where the pavé, slabs and rails are. */
function Ribbon({ segments }: { segments: SegmentView[] }) {
  return (
    <div className="ribbon" aria-hidden="true">
      {segments.map((s, i) => (
        <span key={i} className={`rib ${CLS[s.cls]}${s.rail ? ' rail' : ''}${s.push ? ' push' : ''}`} style={{ flexGrow: Math.max(1, s.length) }} />
      ))}
    </div>
  );
}

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
      <section className="glass panel route-panel compact" ref={panel}>
        <p className="hint">
          <Icon name="search" size={18} /> Chercher une arrivée, ou appui long sur la carte.
        </p>
      </section>
    );
  }

  const r = routes?.find((x) => x.level === selected) ?? routes?.[0];
  return (
    <section className="glass panel route-panel" aria-label="Itinéraire" ref={panel}>
      <div className="grabber" aria-hidden="true" />
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
          <div className="summary">
            <div className="summary-main">
              <span className="big">{m(r.stats.distance)}</span>
              <span className="duration">{min(r.stats.duration)}</span>
            </div>
            <span className={r.level === 0 ? 'delta-pill neutral' : 'delta-pill'}>
              {r.level === 0 ? 'le plus court' : `${signed(r.deltaM)} (${pct(r.deltaPct)}) vs le plus court`}
            </span>
            <button type="button" className="icon-button close" aria-label="Effacer l'itinéraire" onClick={clearRoute}>
              <Icon name="close" />
            </button>
          </div>
          <Ribbon segments={r.segments} />
          <dl className="stats">
            <div className={r.stats.paveM > 0 ? 'stat pave' : 'stat'}>
              <dt>Pavé</dt>
              <dd>{m(r.stats.paveM)}</dd>
            </div>
            <div className={r.stats.railM > 0 ? 'stat rails' : 'stat'}>
              <dt>Le long de rails</dt>
              <dd>{m(r.stats.railM)}</dd>
            </div>
            <div className="stat">
              <dt>Croisements</dt>
              <dd>{r.stats.crossings}</dd>
            </div>
            <div className="stat">
              <dt>À pied</dt>
              <dd>{m(r.stats.pushM)}</dd>
            </div>
          </dl>
          <LevelCards />
          <button type="button" className="button primary start" onClick={() => void startTracking()}>
            <Icon name="navigate" filled size={20} />
            Démarrer
          </button>
        </>
      )}
    </section>
  );
}

/**
 * The single level choice (SPEC §9.1 selector merged with the alternatives): each card shows what
 * that tolerance gives on this trip. Tapping one selects it, with no new calculation.
 */
function LevelCards() {
  const routes = useApp((s) => s.routes);
  const selected = useApp((s) => s.selected);
  const status = useApp((s) => s.routeStatus);
  return (
    <div className="level-cards" role="radiogroup" aria-label="Tolérance au détour">
      {LEVELS.map((l) => {
        const x = routes?.find((r) => r.level === l.id);
        return (
          <button
            key={l.id}
            type="button"
            role="radio"
            aria-checked={l.id === selected}
            aria-label={x ? `${l.label} : ${m(x.stats.distance)}, ${m(x.stats.paveM)} de pavé` : l.label}
            className={l.id === selected ? 'alt on' : 'alt'}
            disabled={status === 'computing' || status === 'locating'}
            onClick={() => setLevel(l.id)}
          >
            <span className="alt-name">{l.label}</span>
            {x && (
              <>
                <span className="alt-figures">{m(x.stats.distance)}</span>
                <span className={x.stats.paveM > 0 ? 'alt-pave' : 'alt-pave none'}>{m(x.stats.paveM)} pavé</span>
                <Ribbon segments={x.segments} />
              </>
            )}
          </button>
        );
      })}
    </div>
  );
}
