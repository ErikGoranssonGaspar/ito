---
name: drive-the-app
description: Launch Itô from source and drive the real Electron window over the Chrome DevTools Protocol - open threads, synthesize mouse and keyboard input, read the OS clipboard. Use when a change has to be verified in the running app rather than in tests, especially anything touching selection, copy and paste, focus, or scrolling.
---

# Driving the real app

Unit tests render components through `react-test-renderer`, with no DOM and no
selection model. Anything that depends on where the browser dispatches an event,
on what `user-select` does to a drag, or on what lands on the clipboard cannot be
settled there. This is how to settle it in the app the owner actually runs.

## Launch with a debugging port

`pnpm dev` already understands `ITO_DESKTOP_REMOTE_DEBUGGING_PORT`
(`apps/desktop/scripts/dev-electron.mjs`), which it forwards to Electron:

```bash
ITO_DESKTOP_REMOTE_DEBUGGING_PORT=9333 pnpm dev > /tmp/ito-dev.log 2>&1 &
```

State stays pinned to this checkout's `.ito`, never `~/.ito`. That directory
already holds test threads, one of them full of rendered math, so there is
usually no need to send a message and spend an agent turn.

Startup takes about a minute, and the port only opens once Electron is up:

```bash
until curl -s --max-time 2 http://127.0.0.1:9333/json/version >/dev/null; do sleep 2; done
curl -s http://127.0.0.1:9333/json/list   # the renderer is the ito-dev://app/ target
```

The log drowns in proxy noise until the backend binds. Filter it:

```bash
grep -vE "ECONNREFUSED|proxy error|internalConnectMultiple|afterConnectMultiple|^AggregateError" /tmp/ito-dev.log
```

Edits under `apps/web` hot-reload into the running window in roughly twelve
seconds, so a before/after comparison is `git checkout -- <file>`, sleep, re-run,
restore from a copy. No relaunch needed.

**Stop it through the task you started** (TaskStop, or the pid you recorded).
Never match on process name. Killing `pnpm dev` mid-`vp build` leaves a partial
`apps/web/dist`, and the next launch fails with
`PlatformError: NotFound: FileSystem.copy (.../apps/web/dist)`; `rm -rf apps/web/dist`
clears it.

## Talk to it

Node 22+ ships a global `WebSocket`, so the driver needs no dependency — which
matters, because pnpm's strict layout leaves `ws` unresolvable from the workspace
root anyway.

```js
// /tmp/cdp.mjs
const targets = await (await fetch("http://127.0.0.1:9333/json/list")).json();
const page = targets.find((t) => t.url.startsWith("ito-dev://"));
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => {
  ws.addEventListener("open", res, { once: true });
  ws.addEventListener("error", rej, { once: true });
});
let nextId = 1;
const pending = new Map();
ws.addEventListener("message", (event) => {
  const msg = JSON.parse(event.data);
  const entry = msg.id && pending.get(msg.id);
  if (!entry) return;
  pending.delete(msg.id);
  msg.error ? entry.reject(new Error(JSON.stringify(msg.error))) : entry.resolve(msg.result);
});
export const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
export async function evaluate(expression) {
  const { result, exceptionDetails } = await send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (exceptionDetails) throw new Error(exceptionDetails.exception?.description);
  return result.value;
}
export { ws };
```

Threads open by clicking their sidebar row; there are no hrefs to navigate to.

```js
await evaluate(`[...document.querySelectorAll('[data-testid="sidebar-row-card"]')]
  .find((el) => /Test Message/.test(el.textContent)).click()`);
```

## Input has to be real

`document.execCommand("copy")` returns `false` here — it is not a user gesture —
and the clipboard silently keeps whatever it held, which reads exactly like a
passing test. **Write a sentinel before every copy** so a stale clipboard cannot
be mistaken for a result:

```bash
printf SENTINEL | pbcopy
```

Real input goes through CDP and arrives as a genuine gesture:

```js
const mouse = (type, p) =>
  send("Input.dispatchMouseEvent", {
    type, x: p.x, y: p.y, button: "left", buttons: 1, clickCount: 1,
  });
await mouse("mousePressed", start);
for (let i = 1; i <= 10; i++) await mouse("mouseMoved", lerp(start, end, i / 10));
await mouse("mouseReleased", end);

for (const type of ["rawKeyDown", "char", "keyUp"]) {
  await send("Input.dispatchKeyEvent", {
    type,
    modifiers: 4, // Meta
    key: "c",
    code: "KeyC",
    windowsVirtualKeyCode: 67,
    nativeVirtualKeyCode: 67,
    text: type === "char" ? "c" : undefined,
    commands: type === "rawKeyDown" ? ["copy"] : undefined,
  });
}
```

Then read what the OS actually received:

```bash
pbpaste                                        # text/plain
osascript -e 'the clipboard as record'         # which flavors were written
osascript -e 'the clipboard as «class HTML»'   # «data HTML<hex>»; decode with bytes.fromhex
```

Take coordinates from `getBoundingClientRect()` after
`scrollIntoView({ block: "center" })` and two `requestAnimationFrame`s, and assert
they are on screen before dragging. A long message puts its own footer thousands
of pixels below the fold, and an off-screen drag selects something else entirely
without telling you.

## What does not work

- **Screenshots and OS-level input.** The sandboxed shell holds no Screen
  Recording or Accessibility grant, so `screencapture` fails with "could not
  create image from display" and AppleScript cannot synthesize a drag. CDP needs
  neither permission.
- **A browser pointed at the web dev server.** The renderer loads and then fails
  bootstrap: repeated 502s on `/api/auth/session`, then
  `HTTP Authentication failed; no valid credentials available`. Only the Electron
  window holds credentials for the dev backend. Drive Electron, not the browser.

## Worked example: where a clipboard event is dispatched

Chromium dispatches `copy` at the element holding the **start** of the selection —
not the common ancestor, and not the anchor. A handler mounted on a message body
therefore never sees a selection that began one line above it, and the copy falls
through to the browser default. Instrument it rather than reasoning about it:

```js
document.addEventListener("copy", (e) => {
  const el = e.target instanceof Element ? e.target : e.target.parentElement;
  window.__copyTarget = el.tagName + " inside=" + Boolean(el.closest(".chat-markdown"));
}, { once: true, capture: true });
```

To build a selection starting outside the rendered markdown, anchor it on timeline
chrome and extend into the message. A programmatic range ignores `user-select:
none`, which a real drag respects — useful for reaching states a drag cannot:

```js
sel.setBaseAndExtent(chromeNode.firstChild, 0, textInMessage, textInMessage.length);
```

This is how the KaTeX copy bug was pinned down: pre-fix the clipboard held the
hidden MathML and the visual spans both, one glyph per line; post-fix it held
`$$y' = q_0(x) + q_1(x)\,y + q_2(x)\,y^2$$`.
