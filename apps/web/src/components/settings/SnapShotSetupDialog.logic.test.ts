import { DEFAULT_CLIENT_SETTINGS, type DesktopSnapShotState } from "@t3tools/contracts";
import { expect, it } from "vite-plus/test";
import {
  captureSetupAccessReady,
  captureSetupInitialStep,
  captureSetupMacPermissionsReady,
  captureSetupShortcutReady,
  captureSetupShouldDisableOnClose,
} from "./SnapShotSetupDialog.logic";

const saved: DesktopSnapShotState = {
  mode: "direct",
  shortcut: DEFAULT_CLIENT_SETTINGS.snapShotShortcut,
  shortcutRegistered: true,
  shortcutMessage: "Requested",
  shortcutVerified: false,
  message: null,
};

it("finishes setup with a saved shortcut without requiring a separate delivery test", () => {
  expect(captureSetupInitialStep(saved)).toBe("shortcut");
  expect(captureSetupShortcutReady(saved, false)).toBe(true);
});

it("still allows revisiting capture access and editing a saved shortcut", () => {
  expect(captureSetupInitialStep(saved, "access")).toBe("access");
  expect(captureSetupInitialStep(saved, "shortcut")).toBe("shortcut");
});

it("does not skip native permission setup when capture has not been enabled", () => {
  expect(captureSetupInitialStep({ ...saved, shortcutRegistered: false })).toBe("access");
});

it("requires saving a changed chord before finishing setup", () => {
  expect(captureSetupShortcutReady(saved, true)).toBe(false);
  expect(captureSetupShortcutReady(saved, false)).toBe(true);
  expect(captureSetupShortcutReady({ ...saved, shortcutRegistered: false }, false)).toBe(false);
});

it.each([false, true])(
  "does not require a previously observed shortcut activation (%s)",
  (shortcutVerified) => {
    const state = { ...saved, shortcutVerified };
    expect(captureSetupShortcutReady(state, false)).toBe(true);
    expect(captureSetupInitialStep(state)).toBe("shortcut");
  },
);

it("blocks finishing if capture access is lost during the wizard", () => {
  expect(
    captureSetupShortcutReady(
      { ...saved, shortcutVerified: true, message: "Screen Recording was revoked" },
      false,
    ),
  ).toBe(false);
  expect(captureSetupAccessReady({ ...saved, mode: "unavailable" })).toBe(false);
});

it.each([
  [false, false, true],
  [false, true, false],
  [true, false, false],
  [true, true, false],
] as const)(
  "closing setup (previously enabled=%s, completed=%s) disables only an unfinished first opt-in",
  (wasEnabled, completed, disable) => {
    expect(captureSetupShouldDisableOnClose(wasEnabled, completed)).toBe(disable);
  },
);

it("gates Continue on macOS permissions, requiring accessibility only when app text is on", () => {
  const mac: DesktopSnapShotState = {
    ...saved,
    macPermissions: { screenRecording: true, accessibility: false },
  };
  expect(captureSetupMacPermissionsReady(mac, true)).toBe(false);
  expect(captureSetupMacPermissionsReady(mac, false)).toBe(true);
  expect(
    captureSetupMacPermissionsReady(
      { ...mac, macPermissions: { screenRecording: false, accessibility: true } },
      false,
    ),
  ).toBe(false);
  expect(captureSetupMacPermissionsReady({ ...mac, macPermissions: undefined }, true)).toBe(true);
});
