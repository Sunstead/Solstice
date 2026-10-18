import { can } from '@/lib/backend/platform';
import { nativeHaptics, type HapticKind } from '@/lib/backend/native';

/** Feedback where the device has a Taptic Engine to give it (the iOS app); nothing elsewhere. */
export const haptics = {
  prepare: () => {
    if (can.nativeViews) void nativeHaptics.prepare();
  },
  play: (kind: HapticKind) => {
    if (can.nativeViews) void nativeHaptics.play(kind);
  },
};
