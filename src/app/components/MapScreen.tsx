import { useEffect } from 'react';
import { loadCorrectionData } from '../corrections/actions.ts';
import { initEngine, loadPreferences } from '../routing/actions.ts';
import { syncWorker } from '../routing/sync.ts';
import { useApp } from '../store.ts';
import { ContextMenu } from './ContextMenu.tsx';
import { LocateButton } from './LocateButton.tsx';
import { CorrectionsList } from './CorrectionsList.tsx';
import { CorrectionsScreen } from './CorrectionsScreen.tsx';
import { DataSheet } from './DataSheet.tsx';
import { MapView } from './MapView.tsx';
import { MenuSheet } from './MenuSheet.tsx';
import { RoutePanel } from './RoutePanel.tsx';
import { SearchPanel } from './SearchPanel.tsx';
import { SearchSheet } from './SearchSheet.tsx';
import { SettingsSheet } from './SettingsSheet.tsx';
import { Toast } from './Toast.tsx';
import { UpdateBanner } from './UpdateBanner.tsx';
import { TrackingOverlay } from './TrackingOverlay.tsx';

/** Map screen (SPEC §9.1) with its tracking (§9.2) and corrections (§9.3) modes. */
export function MapScreen() {
  const sheet = useApp((s) => s.sheet);
  const searchField = useApp((s) => s.searchField);
  const version = useApp((s) => s.installed?.version);
  const mode = useApp((s) => s.mode);

  useEffect(() => {
    if (!version) return;
    // The worker starts at once; settings and corrections load in parallel and are pushed to it as
    // soon as both are ready (initEngine also pushes whatever is loaded when it becomes ready).
    void initEngine(version);
    void Promise.all([loadPreferences(), loadCorrectionData()]).then(() => syncWorker());
  }, [version]);

  return (
    <>
      <MapView />
      {mode === 'tracking' && <TrackingOverlay />}
      {mode === 'corrections' && <CorrectionsScreen />}
      {mode === 'map' && (
        <>
          <SearchPanel />
          <LocateButton />
          <RoutePanel />
          <ContextMenu />
          {searchField && <SearchSheet />}
        </>
      )}
      {mode !== 'tracking' && (
        <>
          {sheet === 'menu' && <MenuSheet />}
          {sheet === 'settings' && <SettingsSheet />}
          {sheet === 'list' && <CorrectionsList />}
          {sheet === 'data' && <DataSheet />}
        </>
      )}
      <Toast />
      <UpdateBanner />
    </>
  );
}
