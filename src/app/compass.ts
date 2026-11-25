/**
 * Device heading for the position arrow: where the phone is pointed. iOS gives
 * webkitCompassHeading after DeviceOrientationEvent.requestPermission(), which must be called from
 * a tap; other browsers give an absolute alpha. Updates are throttled.
 */
import { useApp } from './store.ts';

type OrientationEvt = DeviceOrientationEvent & { webkitCompassHeading?: number };
type PermissionApi = { requestPermission?: () => Promise<'granted' | 'denied'> };

let listening = false;
let lastEmit = 0;
let lastValue = -1;

function onOrientation(e: Event) {
  const o = e as OrientationEvt;
  let h: number | null = null;
  if (typeof o.webkitCompassHeading === 'number' && o.webkitCompassHeading >= 0) h = o.webkitCompassHeading;
  else if (o.absolute && o.alpha !== null) h = (360 - o.alpha) % 360;
  if (h === null) return;
  const angle = (screen.orientation?.angle ?? 0) % 360; // heading of the top of the screen
  h = (h + angle + 360) % 360;
  const now = performance.now();
  const delta = Math.abs(((h - lastValue + 540) % 360) - 180);
  if (now - lastEmit < 80 || (delta < 2 && now - lastEmit < 1000)) return;
  lastEmit = now;
  lastValue = h;
  useApp.setState({ compass: h });
}

/** Must run inside a tap handler (iOS permission prompt). Safe to call repeatedly. */
export async function startCompass(): Promise<'on' | 'denied' | 'unsupported'> {
  const Ctor = (globalThis as unknown as { DeviceOrientationEvent?: PermissionApi }).DeviceOrientationEvent;
  if (!Ctor) return 'unsupported';
  if (typeof Ctor.requestPermission === 'function') {
    try {
      if ((await Ctor.requestPermission()) !== 'granted') return 'denied';
    } catch {
      return 'denied';
    }
  }
  if (!listening) {
    const type = 'ondeviceorientationabsolute' in window ? 'deviceorientationabsolute' : 'deviceorientation';
    window.addEventListener(type, onOrientation, true);
    listening = true;
  }
  return 'on';
}
