import { useState } from 'react';
import { pointEndpoint, saveFavorite, setEndpoint } from '../routing/actions.ts';
import { useApp } from '../store.ts';

/** Long press on the map (SPEC §9.1): go here, start here, add to favourites. */
export function ContextMenu() {
  const menu = useApp((s) => s.menu);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');
  if (!menu) return null;
  const close = () => {
    setNaming(false);
    useApp.setState({ menu: null });
  };
  const endpoint = pointEndpoint(menu.lon, menu.lat, menu.street);
  const left = Math.min(Math.max(12, menu.x - 120), window.innerWidth - 252);
  const top = Math.min(menu.y + 12, window.innerHeight - 260);
  return (
    // Closes on a new touch, not on click: releasing the long press would otherwise "click" the backdrop.
    <div className="menu-backdrop" onPointerDown={close}>
      <div className="context-menu" role="menu" style={{ left, top }} onPointerDown={(e) => e.stopPropagation()}>
        <p className="menu-title">{menu.street ?? 'Point sur la carte'}</p>
        {naming ? (
          <form
            className="fav-form"
            onSubmit={(e) => {
              e.preventDefault();
              void saveFavorite(name || menu.street || 'Favori', menu.lon, menu.lat).then(() => setNaming(false));
            }}
          >
            <input className="search-input" aria-label="Nom du favori" placeholder={menu.street ?? 'Nom du favori'} value={name} onChange={(e) => setName(e.target.value)} autoFocus />
            <button type="submit" className="button">
              Enregistrer
            </button>
          </form>
        ) : (
          <>
            <button type="button" role="menuitem" className="menu-item" onClick={() => setEndpoint('to', endpoint)}>
              Aller ici
            </button>
            <button type="button" role="menuitem" className="menu-item" onClick={() => setEndpoint('from', endpoint)}>
              Partir d'ici
            </button>
            <button
              type="button"
              role="menuitem"
              className="menu-item"
              onClick={() => {
                setName('');
                setNaming(true);
              }}
            >
              Ajouter aux favoris
            </button>
          </>
        )}
      </div>
    </div>
  );
}
