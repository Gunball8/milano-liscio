import { enterCorrections } from '../corrections/actions.ts';
import { useApp } from '../store.ts';

/** Main menu: Corrections, Réglages, Données, surface layer toggle. */
export function MenuSheet() {
  const surfaceLayer = useApp((s) => s.surfaceLayer);
  const reports = useApp((s) => s.reports.filter((r) => r.status === 'todo').length);
  const updateAvailable = useApp((s) => !!s.remote && !!s.installed && s.remote.version !== s.installed.version);
  const close = () => useApp.setState({ sheet: 'none' });
  return (
    <div className="sheet-backdrop" onClick={close}>
      <section className="sheet" role="dialog" aria-label="Menu" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <h2>Menu</h2>
          <button type="button" className="icon-button" onClick={close} aria-label="Fermer">
            ×
          </button>
        </div>
        <button type="button" className="menu-item big" onClick={enterCorrections}>
          Corrections{reports > 0 && <span className="pill">{reports} à trier</span>}
        </button>
        <label className="switch-row">
          <input type="checkbox" role="switch" checked={surfaceLayer} onChange={(e) => useApp.setState({ surfaceLayer: e.target.checked })} />
          Calque des revêtements sur la carte
        </label>
        <button type="button" className="menu-item big" onClick={() => useApp.setState({ sheet: 'settings' })}>
          Réglages
        </button>
        <button type="button" className="menu-item big" onClick={() => useApp.setState({ sheet: 'data' })}>
          Données et sources{updateAvailable && <span className="pill">mise à jour</span>}
        </button>
      </section>
    </div>
  );
}
