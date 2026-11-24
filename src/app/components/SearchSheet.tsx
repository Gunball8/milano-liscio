import { useEffect, useRef, useState } from 'react';
import type { GeoResult } from '../../core/geocode.ts';
import { type Recent, listRecents } from '../../storage/idb.ts';
import { call } from '../routing/client.ts';
import { deleteFavorite, setEndpoint } from '../routing/actions.ts';
import { MY_POSITION, useApp } from '../store.ts';

interface Row {
  key: string;
  label: string;
  sublabel: string;
  onPick: () => void;
  onDelete?: () => void;
}

/** Full-screen offline search (SPEC §9.1). Empty query: my position, favourites, recent places. */
export function SearchSheet() {
  const field = useApp((s) => s.searchField);
  const engine = useApp((s) => s.engine);
  const favorites = useApp((s) => s.favorites);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<GeoResult[]>([]);
  const [recents, setRecents] = useState<Recent[]>([]);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    input.current?.focus();
    void listRecents().then(setRecents).catch(() => undefined);
  }, []);

  useEffect(() => {
    const q = query.trim();
    if (!q || engine !== 'ready') {
      setResults([]);
      return;
    }
    let live = true;
    const t = setTimeout(() => {
      void call({ type: 'search', query: q, limit: 8 }).then((r) => {
        if (live) setResults(r);
      });
    }, 120);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [query, engine]);

  if (!field) return null;
  const close = () => useApp.setState({ searchField: null });
  const pick = (label: string, sublabel: string, lon: number, lat: number, approximate?: boolean) =>
    setEndpoint(field, { kind: 'place', label, sublabel, lon, lat, approximate });

  let rows: Row[];
  if (query.trim()) {
    rows = results.map((r, i) => ({ key: `r${i}`, label: r.label, sublabel: r.sublabel, onPick: () => pick(r.label, r.sublabel, r.lon, r.lat, r.approximate) }));
  } else {
    rows = [
      ...(field === 'from' ? [{ key: 'me', label: 'Ma position', sublabel: 'GPS', onPick: () => setEndpoint('from', MY_POSITION) }] : []),
      ...favorites.map((f) => ({
        key: `f${f.id}`,
        label: `★ ${f.name}`,
        sublabel: 'Favori',
        onPick: () => pick(f.name, 'Favori', f.lon, f.lat),
        onDelete: () => void deleteFavorite(f.id),
      })),
      ...recents.map((r) => ({ key: `h${r.id}`, label: r.label, sublabel: r.sublabel || 'Récent', onPick: () => pick(r.label, r.sublabel, r.lon, r.lat) })),
    ];
  }

  return (
    <div className="search-sheet" role="dialog" aria-label={field === 'from' ? 'Choisir le départ' : "Choisir l'arrivée"}>
      <div className="search-head">
        <input
          ref={input}
          className="search-input"
          type="search"
          inputMode="search"
          enterKeyHint="search"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          placeholder={field === 'from' ? 'Départ : rue, lieu, coordonnées' : 'Arrivée : rue, lieu, coordonnées'}
          aria-label="Rechercher une adresse"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && rows[0]) rows[0].onPick();
          }}
        />
        <button type="button" className="text-button" onClick={close}>
          Annuler
        </button>
      </div>
      {engine !== 'ready' && <p className="note pad">Chargement de l'index des adresses…</p>}
      {query.trim() && engine === 'ready' && results.length === 0 && <p className="note pad">Aucun résultat.</p>}
      <ul className="results" aria-label="Résultats">
        {rows.map((r) => (
          <li key={r.key}>
            <button type="button" className="result" onClick={r.onPick}>
              <span className="result-label">{r.label}</span>
              <span className="result-sub">{r.sublabel}</span>
            </button>
            {r.onDelete && (
              <button type="button" className="icon-button" aria-label={`Supprimer ${r.label}`} onClick={r.onDelete}>
                ×
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
