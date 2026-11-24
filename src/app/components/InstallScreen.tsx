import { continueInBrowser } from '../boot.ts';
import { useApp } from '../store.ts';

function ShareIcon() {
  return (
    <svg className="inline-icon" viewBox="0 0 24 24" aria-label="Partager" role="img">
      <path d="M12 3v12M7.5 7.5 12 3l4.5 4.5M6 11H5v10h14V11h-1" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** SPEC §4.2: no install prompt on iOS, so explain the manual steps. */
export function InstallScreen() {
  const ios = useApp((s) => s.ios);
  return (
    <main className="screen">
      <img className="logo" src={`${import.meta.env.BASE_URL}icons/icon-192.png`} alt="" width="96" height="96" />
      <h1>Installer Milano Liscio</h1>
      <p>Pour marcher sans réseau et garder la carte sur le téléphone, l'appli doit être ajoutée à l'écran d'accueil.</p>
      {ios ? (
        <ol className="steps">
          <li>
            Toucher le bouton Partager <ShareIcon /> de Safari.
          </li>
          <li>Choisir « Sur l'écran d'accueil ».</li>
          <li>Ouvrir Milano Liscio depuis sa nouvelle icône.</li>
        </ol>
      ) : (
        <p>Sur iPhone : ouvrir cette page dans Safari, puis Partager, puis « Sur l'écran d'accueil ».</p>
      )}
      <p className="note">Sans installation, Safari peut effacer les données de l'appli après 7 jours sans visite.</p>
      <button type="button" className="button secondary" onClick={continueInBrowser}>
        Continuer dans le navigateur
      </button>
    </main>
  );
}
