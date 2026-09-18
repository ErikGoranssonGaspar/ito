import { assert, expect, it } from "vite-plus/test";
import { DEFAULT_CLIENT_SETTINGS, type DesktopSnapShotState } from "@t3tools/contracts";

import {
  createRecordingRequestTracker,
  snapShotStatus,
  snapShotShortcutStatus,
  snapShotUnavailableMessage,
  snapShotSoundPatch,
  snapShotSetupSummary,
  snapShotSetupButtonLabel,
  snapShotSetupComplete,
} from "./SnapShotSettings.logic";

const saved: DesktopSnapShotState = {
  mode: "direct",
  shortcut: DEFAULT_CLIENT_SETTINGS.snapShotShortcut,
  shortcutRegistered: true,
  shortcutMessage: null,
  message: null,
};

it.each([
  ["off", { snapShotPlaySound: false }],
  ["soft-pop", { snapShotPlaySound: true, snapShotSound: "soft-pop" }],
  ["camera-shutter", { snapShotPlaySound: true, snapShotSound: "camera-shutter" }],
] as const)("maps %s to compatible capture settings", (sound, patch) => {
  expect(snapShotSoundPatch(sound)).toEqual(patch);
});

it("ignores a stale request after a newer request starts", () => {
  const requests = createRecordingRequestTracker();
  const firstRequest = requests.tryBegin();
  assert(firstRequest);

  requests.clear();
  const secondRequest = requests.tryBegin();
  assert(secondRequest);

  expect(requests.owns(firstRequest)).toBe(false);
  expect(requests.owns(secondRequest)).toBe(true);
  expect(requests.tryBegin()).toBeNull();
});

it("reports unavailable capture support without browser globals", () => {
  expect(snapShotUnavailableMessage(false)).toBe("Only available in the desktop app.");
});

it("keeps unavailable capture distinct from the opt-in setup prompt", () => {
  const state: DesktopSnapShotState = {
    ...saved,
    mode: "unavailable",
    shortcutRegistered: false,
    message: "SnapShots are not supported on this platform.",
  };

  expect(snapShotStatus(state, false)).toBe("SnapShots are not supported on this platform.");
});

it("waits for opt-in before presenting setup requirements", () => {
  const state: DesktopSnapShotState = {
    ...saved,
    shortcutRegistered: false,
    shortcutMessage: "Shortcut permission needed",
    message: "Capture needs attention",
  };

  expect(DEFAULT_CLIENT_SETTINGS.snapShotEnabled).toBe(false);
  expect(snapShotStatus(state, false)).toBe("Turn this on to set up snapshots.");
  expect(snapShotStatus(state, true)).toBe("Capture needs attention");
});

it("distinguishes saved shortcuts from observed delivery without making users repeat setup", () => {
  expect(snapShotSetupSummary(saved, true)).toBe("Shortcut saved");
  expect(snapShotSetupButtonLabel(saved)).toBe("Manage capture");
  expect(snapShotSetupSummary({ ...saved, shortcutVerified: true }, true)).toBe("Ready to capture");
  expect(snapShotSetupButtonLabel({ ...saved, shortcutVerified: true })).toBe("Manage capture");
  expect(snapShotSetupSummary({ ...saved, shortcutVerified: true }, false)).toContain(
    "Enable capture",
  );
  expect(snapShotSetupSummary({ ...saved, shortcutRegistered: false }, true)).toBe(
    "Finish shortcut setup",
  );
});

it("reports denied and assigned shortcuts without inferring consent from saved keys", () => {
  const denied = {
    ...saved,
    shortcutRegistered: false,
    shortcutMessage: "This shortcut is already used by the system or another app.",
  };
  expect(snapShotShortcutStatus(denied)).toBe(
    "This shortcut is already used by the system or another app.",
  );
  expect(snapShotShortcutStatus(saved)).toBe("Shortcut saved.");
  expect(snapShotStatus({ ...saved, shortcutVerified: true }, true)).toBe("Ready to capture");
});

it("hides macOS setup only while permissions and the shortcut are all in place", () => {
  const ready: DesktopSnapShotState = {
    ...saved,
    macPermissions: { screenRecording: true, accessibility: true },
  };
  expect(snapShotSetupComplete(ready, true)).toBe(true);
  expect(snapShotSetupComplete({ ...ready, macPermissions: undefined }, true)).toBe(false);
  expect(snapShotSetupComplete({ ...ready, shortcutRegistered: false }, true)).toBe(false);
  const revoked = {
    ...ready,
    macPermissions: { screenRecording: true, accessibility: false },
    message: "Allow Accessibility in System Settings, then restart T3 Code.",
  };
  expect(snapShotSetupComplete(revoked, true)).toBe(false);
  expect(snapShotStatus(revoked, true)).toBe("Capture needs attention");
  expect(snapShotSetupButtonLabel(revoked)).toBe("Continue setup");
  expect(snapShotSetupComplete({ ...revoked, message: null }, false)).toBe(true);
});
