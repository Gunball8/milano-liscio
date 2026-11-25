import { useApp } from '../store.ts';
import { Icon } from './Icon.tsx';

/** Shown once a new version of the app has been installed in the background. Never while riding. */
export function UpdateBanner() {
  const updated = useApp((s) => s.appUpdated);
  const mode = useApp((s) => s.mode);
  if (!updated || mode === 'tracking') return null;
  return (
    <div className="glass update-banner" role="status">
      <span>Nouvelle version de l'appli prête.</span>
      <button type="button" className="button compact" onClick={() => window.location.reload()}>
        <Icon name="check" size={18} />
        Recharger
      </button>
    </div>
  );
}
