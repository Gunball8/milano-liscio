import { setEndpoint, swapEndpoints } from '../routing/actions.ts';
import { useApp } from '../store.ts';

/** Top of the map screen (SPEC §9.1): departure ("Ma position" by default), arrival, favourites. */
export function SearchPanel() {
  const from = useApp((s) => s.from);
  const to = useApp((s) => s.to);
  const favorites = useApp((s) => s.favorites);
  const updateAvailable = useApp((s) => !!s.remote && !!s.installed && s.remote.version !== s.installed.version);
  const open = (field: 'from' | 'to') => useApp.setState({ searchField: field, menu: null });
  return (
    <header className="search-panel">
      <div className="search-card">
        <div className="fields">
          <button type="button" className="field" aria-label={`Départ : ${from.label}`} onClick={() => open('from')}>
            <span className="field-dot from" aria-hidden="true" />
            <span className="field-text">{from.label}</span>
          </button>
          <button type="button" className="field" aria-label={`Arrivée : ${to?.label ?? 'à choisir'}`} onClick={() => open('to')}>
            <span className="field-dot to" aria-hidden="true" />
            <span className={to ? 'field-text' : 'field-text placeholder'}>{to?.label ?? 'Où aller ?'}</span>
          </button>
        </div>
        <div className="side-buttons">
          <button type="button" className="icon-button" aria-label="Inverser départ et arrivée" onClick={swapEndpoints} disabled={!to}>
            ⇅
          </button>
          <button type="button" className="icon-button" aria-label="Données" onClick={() => useApp.setState({ sheet: 'data', menu: null })}>
            ⓘ{updateAvailable && <span className="dot badge" aria-label="mise à jour disponible" />}
          </button>
        </div>
      </div>
      {favorites.length > 0 && (
        <div className="chips-row" aria-label="Favoris">
          {favorites.map((f) => (
            <button
              key={f.id}
              type="button"
              className="chip small"
              onClick={() => setEndpoint('to', { kind: 'place', label: f.name, sublabel: 'Favori', lon: f.lon, lat: f.lat })}
            >
              ★ {f.name}
            </button>
          ))}
        </div>
      )}
    </header>
  );
}
