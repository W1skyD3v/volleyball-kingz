import * as Location from 'expo-location';
import type { Fix } from '@vk/core';

export type FixResult = { ok: true; fix: Fix } | { ok: false; reason: 'no_permission' | 'unavailable' };

/** Foreground location only. Never requests background permission. */
export async function getForegroundFix(): Promise<FixResult> {
  const perm = await Location.requestForegroundPermissionsAsync();
  if (perm.status !== 'granted') return { ok: false, reason: 'no_permission' };
  try {
    const p = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
    return { ok: true, fix: { lat: p.coords.latitude, lng: p.coords.longitude, accuracyM: p.coords.accuracy } };
  } catch {
    return { ok: false, reason: 'unavailable' };
  }
}
