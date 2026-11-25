import { useEffect, useRef, useState } from 'react';
import type { NextStretch, StretchKind } from '../../core/tracking.ts';
import { report, setFollowing, stopTracking } from '../tracking/session.ts';
import { useApp } from '../store.ts';
import { usePanelHeight } from '../usePanelHeight.ts';
import { Icon } from './Icon.tsx';

const KIND_LABEL: Record<StretchKind, string> = { pave: 'pavé', rails: 'rails', slabs: 'dalles', push: 'à pied' };
const m10 = (v: number) => (v >= 1000 ? `${(v / 1000).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} km` : `${Math.max(10, Math.round(v / 10) * 10)} m`);
const clock = (ms: number) => new Date(ms).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

export function nextText(n: NextStretch | null): string {
  if (!n) return "Lisse jusqu'à l'arrivée";
  const what = n.kinds.map((k) => KIND_LABEL[k]).join(' + ');
  const cap = what.charAt(0).toUpperCase() + what.slice(1);
  return n.inM < 5 ? `${cap} sur encore ${m10(n.lengthM)}` : `${cap} dans ${m10(n.inM)}, sur ${m10(n.lengthM)}`;
}

const LOCK_HINT: Partial<Record<string, string>> = {
  unsupported: "Cet appareil ne peut pas garder l'écran allumé : régler le verrouillage automatique sur « Jamais » pendant le trajet.",
  denied: "Maintien de l'écran allumé refusé : régler le verrouillage automatique sur « Jamais » pendant le trajet.",
  error: "Maintien de l'écran allumé indisponible : régler le verrouillage automatique sur « Jamais » pendant le trajet.",
};

/** Tracking screen (SPEC §9.2): banner, imprecise-GPS indicator, report button, arrival. */
export function TrackingOverlay() {
  const t = useApp((s) => s.tracking);
  const [flash, setFlash] = useState(false);
  const controls = useRef<HTMLElement>(null);
  usePanelHeight(controls, 16);
  useEffect(() => {
    if (!flash) return;
    const id = setTimeout(() => setFlash(false), 1800);
    return () => clearTimeout(id);
  }, [flash]);
  if (!t) return null;
  const kind = t.next?.kinds[0] ?? 'smooth';

  return (
    <>
      <section className="nav-banner" aria-label="Suivi" aria-live="polite">
        <div className="nav-next">
          <span className={`nav-chip ${kind}`} aria-hidden="true" />
          {nextText(t.next)}
        </div>
        <div className="nav-meta">
          <strong>{m10(t.remainingM)}</strong> restants · arrivée {clock(t.etaMs)}
        </div>
        {(t.imprecise || t.recalculating || t.error) && (
          <div className="nav-flags">
            {t.imprecise && t.accuracy !== null && <span className="flag">GPS imprécis (±{Math.round(t.accuracy)} m)</span>}
            {t.recalculating && <span className="flag">Recalcul…</span>}
            {t.error && <span className="flag danger">{t.error}</span>}
          </div>
        )}
        {LOCK_HINT[t.lock] && <p className="nav-hint">{LOCK_HINT[t.lock]}</p>}
      </section>

      {t.arrived ? (
        <section className="glass panel arrival" role="dialog" aria-label="Arrivée" ref={controls}>
          <div className="arrival-head">
            <span className="arrival-check">
              <Icon name="check" size={26} />
            </span>
            <h2>Arrivé</h2>
          </div>
          {t.reports > 0 && <p className="note">{t.reports} signalement{t.reports > 1 ? 's' : ''} à trier dans Corrections.</p>}
          <button type="button" className="button primary" onClick={() => void stopTracking()}>
            Terminer
          </button>
        </section>
      ) : (
        <footer className="nav-controls" ref={controls}>
          <button type="button" className="glass button secondary compact" onClick={() => void stopTracking()}>
            <Icon name="stop" size={18} filled />
            Terminer
          </button>
          <button
            type="button"
            className={flash ? 'button report compact done' : 'button report compact'}
            onClick={() => {
              void report().then(() => setFlash(true));
            }}
          >
            <Icon name={flash ? 'check' : 'flag'} size={19} />
            {flash ? 'Enregistré' : 'Signaler'}
            {t.reports > 0 && <span className="count">{t.reports}</span>}
          </button>
          {!t.following && (
            <button type="button" className="glass round-button" aria-label="Recentrer" onClick={() => setFollowing(true)}>
              <Icon name="navigate" filled />
            </button>
          )}
        </footer>
      )}
    </>
  );
}
