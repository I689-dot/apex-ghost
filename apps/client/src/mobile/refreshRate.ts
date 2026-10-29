import { registerPlugin } from '@capacitor/core';
import { settings } from '../settings';

/**
 * 90/120/144 Hz on phones that have it (Settings → Frame rate). The WebView draws at the window's display mode, which
 * Android keeps at 60 Hz unless the app asks: RefreshRatePlugin.java lists the screen's rates and picks the mode.
 * Outside the native shell (dev preview, website) there is nothing to set: only 60 is offered.
 */
interface RefreshRatePlugin {
  getRates(): Promise<{ rates: number[]; current: number }>;
  setRate(o: { hz: number }): Promise<{ hz: number }>;
}
const native = registerPlugin<RefreshRatePlugin>('RefreshRate');

/** The choices offered in Settings: 60 plus the screen's 90 / 120 / 144 Hz modes. */
export async function frameRateChoices(): Promise<number[]> {
  try {
    const { rates } = await native.getRates();
    return [60, ...[90, 120, 144].filter((hz) => rates.some((r) => Math.abs(r - hz) <= 1))];
  } catch {
    return [60];
  }
}

/** Ask for the display mode of the chosen rate (60: the phone's default). */
export async function applyFrameRate(hz = settings.refreshRate): Promise<void> {
  try {
    await native.setRate({ hz });
  } catch {
    /* not in the native shell */
  }
}
