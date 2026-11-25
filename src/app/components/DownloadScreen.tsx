import { transferSize } from '../../storage/dataCache.ts';
import { offerDownload, startFirstDownload } from '../boot.ts';
import { fmtDate, fmtMB } from '../format.ts';
import { useApp } from '../store.ts';

export function ProgressBar({ loaded, total }: { loaded: number; total: number }) {
  const pct = total > 0 ? Math.min(100, (100 * loaded) / total) : 0;
  return (
    <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)}>
      <div className="progress-fill" style={{ width: `${pct}%` }} />
    </div>
  );
}

/** First launch: offer, progress and errors of the initial data download (SPEC §8, §9.4). */
export function DownloadScreen() {
  const phase = useApp((s) => s.phase);
  const remote = useApp((s) => s.remote);
  const progress = useApp((s) => s.progress);
  const error = useApp((s) => s.error);

  if (phase === 'error') {
    return (
      <main className="screen">
        <h1>Téléchargement impossible</h1>
        <p>{error === 'offline' ? "Pas de connexion. Le premier téléchargement a besoin du réseau ; ensuite, l'appli marche sans." : error}</p>
        <button type="button" className="button" onClick={() => void offerDownload()}>
          Réessayer
        </button>
      </main>
    );
  }

  if (phase === 'downloading' && progress) {
    return (
      <main className="screen">
        <h1>Téléchargement des données</h1>
        <ProgressBar loaded={progress.loaded} total={progress.total} />
        <p className="figures">{progress.total > 0 ? Math.floor((100 * progress.loaded) / progress.total) : 0}&nbsp;%</p>
        <p className="note">Garder l'appli ouverte jusqu'à la fin.</p>
      </main>
    );
  }

  return (
    <main className="screen">
      <h1>Carte hors-ligne</h1>
      <p>La carte et le réseau cyclable de Milan sont gardés sur le téléphone : l'appli marche ensuite sans réseau.</p>
      {remote ? (
        <>
          <p className="note">Données OpenStreetMap du {fmtDate(remote.osmBase)}.</p>
          <button type="button" className="button" onClick={() => void startFirstDownload(remote)}>
            Télécharger (≈&nbsp;{fmtMB(transferSize(remote))})
          </button>
        </>
      ) : (
        <p className="note">Vérification de la version disponible…</p>
      )}
    </main>
  );
}
