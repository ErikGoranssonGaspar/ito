import type { DesktopAppBranding } from "@ito/contracts";

function readInjectedDesktopAppBranding(): DesktopAppBranding | null {
  if (typeof window === "undefined") {
    return null;
  }

  return window.desktopBridge?.getAppBranding?.() ?? null;
}

const injectedDesktopAppBranding = readInjectedDesktopAppBranding();

export const APP_BASE_NAME = injectedDesktopAppBranding?.baseName ?? "Itô";
export const APP_STAGE_LABEL =
  injectedDesktopAppBranding?.stageLabel ?? (import.meta.env.DEV ? "Dev" : "Alpha");
// The app is called Itô everywhere it names itself. The stage label survives only
// as a build marker for the sidebar backdrop, not as part of the name.
export const APP_DISPLAY_NAME = injectedDesktopAppBranding?.displayName ?? APP_BASE_NAME;
export const APP_VERSION = import.meta.env.APP_VERSION || "0.0.0";
