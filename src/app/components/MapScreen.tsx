import { useEffect } from 'react';
import { initEngine, loadPreferences } from '../routing/actions.ts';
import { useApp } from '../store.ts';
import { ContextMenu } from './ContextMenu.tsx';
import { DataSheet } from './DataSheet.tsx';
import { MapView } from './MapView.tsx';
import { RoutePanel } from './RoutePanel.tsx';
import { SearchPanel } from './SearchPanel.tsx';
import { SearchSheet } from './SearchSheet.tsx';
import { TrackingOverlay } from './TrackingOverlay.tsx';

/** Map screen (SPEC §9.1). */
export function MapScreen() {
  const sheet = useApp((s) => s.sheet);
  const searchField = useApp((s) => s.searchField);
  const version = useApp((s) => s.installed?.version);
  const mode = useApp((s) => s.mode);

  useEffect(() => {
    void loadPreferences();
  }, []);
  useEffect(() => {
    if (version) void initEngine(version);
  }, [version]);

  return (
    <>
      <MapView />
      {mode === 'tracking' ? (
        <TrackingOverlay />
      ) : (
        <>
          <SearchPanel />
          <RoutePanel />
          <ContextMenu />
          {searchField && <SearchSheet />}
        </>
      )}
      {sheet === 'data' && <DataSheet />}
    </>
  );
}
