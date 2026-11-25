import { useEffect, useRef, useState } from 'react';
import { DEFAULT_FACTORS } from '../../core/cost.ts';
import { savePrefs } from '../corrections/actions.ts';
import { useApp } from '../store.ts';
import { Icon } from './Icon.tsx';
import { DEFAULT_PREFS, type Prefs } from '../../worker/protocol.ts';

const FACTORS: [keyof Prefs['factors'], string][] = [
  ['pave', 'Pavé'],
  ['slabs', 'Dalles'],
  ['rails', 'Rails'],
  ['crossings', 'Croisements obliques'],
];
const times = (v: number) => `×${v.toLocaleString('fr-FR', { maximumFractionDigits: 2 })}`;

/** Settings (SPEC §9.4). Changes apply to the next calculation. */
export function SettingsSheet() {
  const saved = useApp((s) => s.prefs);
  const [prefs, setPrefs] = useState<Prefs>(saved);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const close = () => useApp.setState({ sheet: 'none' });

  // Sliders move freely; the save (and the route recalculation) waits for a short pause.
  const update = (patch: Partial<Prefs>) => {
    const next = { ...prefs, ...patch, factors: { ...prefs.factors, ...patch.factors } };
    setPrefs(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void savePrefs(next), 400);
  };
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  return (
    <div className="sheet-backdrop" onClick={close}>
      <section className="sheet tall" role="dialog" aria-label="Réglages" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <h2>Réglages</h2>
          <button type="button" className="icon-button" onClick={close} aria-label="Fermer">
            <Icon name="close" />
          </button>
        </div>
        <label className="slider">
          <span>
            Vitesse moyenne <strong>{prefs.speed} km/h</strong>
          </span>
          <input type="range" min={10} max={25} step={1} value={prefs.speed} aria-label="Vitesse moyenne" onChange={(e) => update({ speed: Number(e.target.value) })} />
        </label>
        <h3>Pénalités avancées</h3>
        <p className="note">Multiplient la pénalité de chaque niveau. ×1 = valeurs d'origine.</p>
        {FACTORS.map(([key, label]) => (
          <label className="slider" key={key}>
            <span>
              {label} <strong>{times(prefs.factors[key])}</strong>
            </span>
            <input
              type="range"
              min={0.5}
              max={2}
              step={0.25}
              value={prefs.factors[key]}
              aria-label={`Pénalité ${label}`}
              onChange={(e) => update({ factors: { ...prefs.factors, [key]: Number(e.target.value) } })}
            />
          </label>
        ))}
        <button type="button" className="button secondary" onClick={() => update({ ...DEFAULT_PREFS, factors: DEFAULT_FACTORS })}>
          Rétablir les valeurs par défaut
        </button>
        <button type="button" className="text-button" onClick={() => useApp.setState({ sheet: 'data' })}>
          Données, stockage et sources
        </button>
      </section>
    </div>
  );
}
