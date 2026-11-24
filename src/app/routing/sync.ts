/** Pushes settings and corrections to the routing worker (after start-up and after every change). */
import { useApp } from '../store.ts';
import { call } from './client.ts';

export async function syncWorker() {
  const { engine, prefs, corrections } = useApp.getState();
  if (engine !== 'ready') return;
  await call({ type: 'setOptions', prefs });
  const statuses = await call({ type: 'setCorrections', corrections });
  useApp.setState((s) => ({ correctionStatus: Object.fromEntries(statuses.map((x) => [x.id, x])), surfaceKey: s.surfaceKey + 1 }));
}
