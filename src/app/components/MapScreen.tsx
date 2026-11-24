import { useApp } from '../store.ts';
import { DataSheet } from './DataSheet.tsx';
import { MapView } from './MapView.tsx';

export function MapScreen() {
  const sheet = useApp((s) => s.sheet);
  const remote = useApp((s) => s.remote);
  const installed = useApp((s) => s.installed);
  const updateAvailable = !!remote && !!installed && remote.version !== installed.version;
  return (
    <>
      <MapView />
      <header className="topbar">
        <span className="brand">Milano Liscio</span>
        <button type="button" className="chip" onClick={() => useApp.setState({ sheet: 'data' })}>
          Données
          {updateAvailable && <span className="dot" aria-label="mise à jour disponible" />}
        </button>
      </header>
      {sheet === 'data' && <DataSheet />}
    </>
  );
}
