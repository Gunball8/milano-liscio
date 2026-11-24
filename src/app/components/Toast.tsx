import { useApp } from '../store.ts';

export function Toast() {
  const toast = useApp((s) => s.toast);
  return toast ? (
    <div className="toast" role="status">
      {toast}
    </div>
  ) : null;
}
