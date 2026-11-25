import { favoriteAt, setEndpoint, swapEndpoints, toggleFavorite } from '../routing/actions.ts';
import { useApp } from '../store.ts';
import { Icon } from './Icon.tsx';

/** Top of the map screen (SPEC §9.1): departure ("Ma position" by default), arrival, favourites. */
export function SearchPanel() {
  const from = useApp((s) => s.from);
  const to = useApp((s) => s.to);
  const favorites = useApp((s) => s.favorites);
  const updateAvailable = useApp((s) => !!s.remote && !!s.installed && s.remote.version !== s.installed.version);
  const open = (field: 'from' | 'to') => useApp.setState({ searchField: field, menu: null });
  const toPlace = to?.kind === 'place' && to.lon !== undefined && to.lat !== undefined ? to : null;
  const fav = toPlace ? favoriteAt(toPlace.lon, toPlace.lat) : undefined;
  return (
    <header className="search-panel">
      <div className="search-row">
        <div className="glass search-card">
          <button type="button" className="field" aria-label={`Départ : ${from.label}`} onClick={() => open('from')}>
            <span className="origin-mark" aria-hidden="true" />
            <span className="field-text">{from.label}</span>
          </button>
          <div className="field-sep" />
          <div className="field-line">
            <button type="button" className="field" aria-label={`Arrivée : ${to?.label ?? 'à choisir'}`} onClick={() => open('to')}>
              <Icon name="pin" size={20} className="dest-mark" />
              <span className={to ? 'field-text' : 'field-text placeholder'}>{to?.label ?? 'Où aller ?'}</span>
            </button>
            {toPlace && (
              <button
                type="button"
                className={fav ? 'icon-button star on' : 'icon-button star'}
                aria-pressed={!!fav}
                aria-label={fav ? `Retirer ${toPlace.label} des favoris` : `Ajouter ${toPlace.label} aux favoris`}
                onClick={() => void toggleFavorite(toPlace.label, toPlace.lon!, toPlace.lat!)}
              >
                <Icon name="star" filled={!!fav} />
              </button>
            )}
          </div>
          <button type="button" className="swap-button" aria-label="Inverser départ et arrivée" onClick={swapEndpoints} disabled={!to}>
            <Icon name="swap" size={20} />
          </button>
        </div>
        <button type="button" className="glass round-button" aria-label="Menu" onClick={() => useApp.setState({ sheet: 'menu', menu: null })}>
          <Icon name="menu" />
          {updateAvailable && <span className="badge-dot" aria-label="mise à jour disponible" />}
        </button>
      </div>
      {favorites.length > 0 && (
        <div className="chips-row" aria-label="Favoris">
          {favorites.map((f) => (
            <button
              key={f.id}
              type="button"
              className="glass chip fav"
              aria-label={`Favori ${f.name}`}
              onClick={() => setEndpoint('to', { kind: 'place', label: f.name, sublabel: 'Favori', lon: f.lon, lat: f.lat })}
            >
              <Icon name="star" filled size={15} />
              {f.name}
            </button>
          ))}
        </div>
      )}
    </header>
  );
}
