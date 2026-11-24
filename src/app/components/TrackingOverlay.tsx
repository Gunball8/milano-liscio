import { useEffect, useRef, useState } from 'react';
import type { NextStretch, StretchKind } from '../../core/tracking.ts';
import { report, setFollowing, stopTracking } from '../tracking/session.ts';
import { useApp } from '../store.ts';
import { usePanelHeight } from '../usePanelHeight.ts';

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

/** Tracking screen (SPEC §9.2): banner, imprecise-GPS indicator, big report button, arrival. */
export function TrackingOverlay() {
  const t = useApp((s) => s.tracking);
  const [flash, setFlash] = useState(false);
  const controls = useRef<HTMLElement>(null);
  usePanelHeight(controls, 24);
  useEffect(() => {
    if (!flash) return;
    const id = setTimeout(() => setFlash(false), 1800);
    return () => clearTimeout(id);
  }, [flash]);
  if (!t) return null;

  return (
    <>
      <section className="track-banner" aria-label="Suivi" aria-live="polite">
        <div className="track-main">
          <strong>{m10(t.remainingM)}</strong> restants · arrivée {clock(t.etaMs)}
        </div>
        <div className={t.next ? 'track-next warn' : 'track-next'}>{nextText(t.next)}</div>
        <div className="track-flags">
          {t.imprecise && t.accuracy !== null && <span className="flag">GPS imprécis (±{Math.round(t.accuracy)} m)</span>}
          {t.recalculating && <span className="flag">Recalcul…</span>}
          {t.error && <span className="flag danger">{t.error}</span>}
        </div>
        {LOCK_HINT[t.lock] && <p className="track-hint">{LOCK_HINT[t.lock]}</p>}
      </section>

      {t.arrived ? (
        <section className="arrival" role="dialog" aria-label="Arrivée" ref={controls}>
          <h2>Arrivé</h2>
          {t.reports > 0 && <p className="note">{t.reports} signalement{t.reports > 1 ? 's' : ''} à trier dans Corrections.</p>}
          <button type="button" className="button" onClick={() => void stopTracking()}>
            Terminer
          </button>
        </section>
      ) : (
        <footer className="track-controls" ref={controls}>
          {!t.following && (
            <button type="button" className="button secondary" onClick={() => setFollowing(true)}>
              Recentrer
            </button>
          )}
          <button
            type="button"
            className="report-button"
            onClick={() => {
              void report().then(() => setFlash(true));
            }}
          >
            {flash ? 'Enregistré' : 'Signaler'}
            {t.reports > 0 && <span className="report-count">{t.reports}</span>}
          </button>
          <button type="button" className="button secondary" onClick={() => void stopTracking()}>
            Terminer
          </button>
        </footer>
      )}
    </>
  );
}
