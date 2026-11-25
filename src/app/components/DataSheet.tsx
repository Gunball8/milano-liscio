import { useEffect, useState } from 'react';
import { storageStatus, totalSize, transferSize } from '../../storage/dataCache.ts';
import { checkForUpdate, startUpdate } from '../boot.ts';
import { fmtDate, fmtMB } from '../format.ts';
import { useApp } from '../store.ts';
import { Icon } from './Icon.tsx';
import { ProgressBar } from './DownloadScreen.tsx';

/** "Données" screen (SPEC §8): installed vs available version, update, storage, attributions. */
export function DataSheet() {
  const installed = useApp((s) => s.installed);
  const remote = useApp((s) => s.remote);
  const updating = useApp((s) => s.updating);
  const progress = useApp((s) => s.progress);
  const error = useApp((s) => s.error);
  const standalone = useApp((s) => s.standalone);
  const [storage, setStorage] = useState<Awaited<ReturnType<typeof storageStatus>> | null>(null);

  useEffect(() => {
    void storageStatus().then(setStorage);
  }, [installed?.version]);

  const close = () => useApp.setState({ sheet: 'none' });
  const updateAvailable = !!remote && !!installed && remote.version !== installed.version;

  return (
    <div className="sheet-backdrop" onClick={close}>
      <section className="sheet" role="dialog" aria-label="Données" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <h2>Données</h2>
          <button type="button" className="icon-button" onClick={close} aria-label="Fermer">
            <Icon name="close" />
          </button>
        </div>

        <dl className="facts">
          <dt>Installées</dt>
          <dd>
            OpenStreetMap du {fmtDate(installed?.osmBase)}
            <br />
            <span className="note">
              version {installed?.version} · {installed ? fmtMB(totalSize(installed)) : '–'}
            </span>
          </dd>
          <dt>Disponibles</dt>
          <dd>
            {remote === undefined && 'vérification…'}
            {remote === null && 'hors ligne'}
            {remote && !updateAvailable && 'à jour'}
            {remote && updateAvailable && `OpenStreetMap du ${fmtDate(remote.osmBase)} (≈ ${fmtMB(transferSize(remote))} à télécharger)`}
          </dd>
          <dt>Stockage</dt>
          <dd>
            {storage?.persisted ? 'persistant' : standalone ? 'non garanti' : 'non garanti (appli non installée)'}
            {storage?.usage != null && <span className="note"> · {fmtMB(storage.usage)} utilisés</span>}
          </dd>
        </dl>

        {updating && progress ? (
          <>
            <ProgressBar loaded={progress.loaded} total={progress.total} />
            <p className="figures">{progress.total > 0 ? Math.floor((100 * progress.loaded) / progress.total) : 0}&nbsp;%</p>
          </>
        ) : updateAvailable ? (
          <button type="button" className="button" onClick={() => void startUpdate()}>
            Mettre à jour
          </button>
        ) : (
          <button type="button" className="button secondary" onClick={() => void checkForUpdate()}>
            Vérifier les mises à jour
          </button>
        )}
        {error && <p className="error-text">{error}</p>}

        <h3>Sources</h3>
        <p className="note">
          Carte et réseau : ©{' '}
          <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">
            contributeurs OpenStreetMap
          </a>{' '}
          (ODbL). Fond de carte :{' '}
          <a href="https://protomaps.com" target="_blank" rel="noopener noreferrer">
            Protomaps
          </a>, build {installed?.basemapBuild?.replace('.pmtiles', '') ?? '–'}. Polices Noto (OFL).
        </p>
      </section>
    </div>
  );
}
