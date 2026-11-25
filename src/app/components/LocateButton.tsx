import { locateMe } from '../routing/actions.ts';
import { useApp } from '../store.ts';
import { Icon } from './Icon.tsx';

/** Centres the map on the user; the tap also lets iOS ask for the compass (arrow direction). */
export function LocateButton() {
  const hasCompass = useApp((s) => s.compass !== null);
  return (
    <button type="button" className={hasCompass ? 'glass round-button locate on' : 'glass round-button locate'} aria-label="Me localiser" onClick={() => void locateMe()}>
      <Icon name={hasCompass ? 'navigate' : 'locate'} filled={hasCompass} />
    </button>
  );
}
