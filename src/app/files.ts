/**
 * Saving a file from the app: the iOS share sheet when it accepts files (save to Files, AirDrop…),
 * else a regular download. Tests force the download path with localStorage "liscio.downloadOnly".
 */
export async function saveFile(name: string, mime: string, text: string): Promise<'shared' | 'downloaded' | 'cancelled'> {
  const file = new File([text], name, { type: mime });
  let downloadOnly = false;
  try {
    downloadOnly = localStorage.getItem('liscio.downloadOnly') === '1';
  } catch {
    /* storage blocked: keep default */
  }
  if (!downloadOnly && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: name });
      return 'shared';
    } catch (err) {
      if ((err as { name?: string }).name === 'AbortError') return 'cancelled';
    }
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  return 'downloaded';
}

export const today = () => new Date().toISOString().slice(0, 10);
