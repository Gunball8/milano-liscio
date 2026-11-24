import { useEffect } from 'react';
import { boot } from './boot.ts';
import { DownloadScreen } from './components/DownloadScreen.tsx';
import { InstallScreen } from './components/InstallScreen.tsx';
import { MapScreen } from './components/MapScreen.tsx';
import { useApp } from './store.ts';

export function App() {
  const phase = useApp((s) => s.phase);
  useEffect(() => {
    void boot();
  }, []);
  if (phase === 'boot') return <main className="screen" aria-busy="true" />;
  if (phase === 'install') return <InstallScreen />;
  if (phase === 'ready') return <MapScreen />;
  return <DownloadScreen />;
}
