/**
 * Screen wake lock manager (SPEC §4.4). Works in installed web apps from iOS 18.4. The lock is lost
 * whenever the app goes to the background, so it is requested again when the page becomes visible.
 * The browser API is injected so the logic can be tested without a browser.
 */
export interface LockSentinelLike {
  release(): Promise<void>;
  addEventListener?(type: 'release', listener: () => void): void;
}

export interface WakeLockLike {
  request(type: 'screen'): Promise<LockSentinelLike>;
}

export type LockState = 'off' | 'on' | 'unsupported' | 'denied' | 'error';

export class ScreenLock {
  private sentinel: LockSentinelLike | null = null;
  private wanted = false;
  state: LockState = 'off';

  constructor(
    private readonly api: WakeLockLike | undefined,
    private readonly onState: (s: LockState) => void = () => undefined,
  ) {}

  private set(s: LockState) {
    this.state = s;
    this.onState(s);
  }

  private async acquire(): Promise<LockState> {
    if (!this.api) {
      this.set('unsupported');
      return this.state;
    }
    try {
      const s = await this.api.request('screen');
      if (!this.wanted) {
        await s.release();
        return this.state;
      }
      this.sentinel = s;
      s.addEventListener?.('release', () => {
        if (this.sentinel === s) this.sentinel = null;
        if (this.wanted) this.set('off');
      });
      this.set('on');
    } catch (err) {
      this.set((err as { name?: string })?.name === 'NotAllowedError' ? 'denied' : 'error');
    }
    return this.state;
  }

  enable(): Promise<LockState> {
    this.wanted = true;
    return this.sentinel ? Promise.resolve(this.state) : this.acquire();
  }

  /** Call when the page becomes visible again (after a lock screen or an app switch). */
  async onVisible(): Promise<void> {
    if (this.wanted && !this.sentinel) await this.acquire();
  }

  async disable(): Promise<void> {
    this.wanted = false;
    const s = this.sentinel;
    this.sentinel = null;
    await s?.release().catch(() => undefined);
    this.set('off');
  }
}
