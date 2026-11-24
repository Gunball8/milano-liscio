import { LEVELS } from '../../core/cost.ts';
import { setLevel } from '../routing/actions.ts';
import { useApp } from '../store.ts';

/** 4-step tolerance selector (SPEC §9.1). */
export function LevelSelector() {
  const level = useApp((s) => s.level);
  return (
    <div className="segmented" role="radiogroup" aria-label="Tolérance au détour">
      {LEVELS.map((l) => (
        <button key={l.id} type="button" role="radio" aria-checked={level === l.id} className={level === l.id ? 'seg on' : 'seg'} onClick={() => setLevel(l.id)}>
          {l.label}
        </button>
      ))}
    </div>
  );
}
