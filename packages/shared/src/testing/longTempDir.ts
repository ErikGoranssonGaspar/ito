// @effect-diagnostics nodeBuiltinImport:off - runs once at test setup, outside any Effect runtime.
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";

// Point the temp directory at its canonical form before any suite makes one.
//
// Anything that canonicalises a path, such as git or realpath, reports the
// canonical form, so equality checks between a temp path and its canonical
// form fail. Two hosts hand out a non-canonical temp directory:
//
// - GitHub's Windows runners use the 8.3 short name (C:\Users\RUNNER~1\...).
// - macOS puts it under /var/folders/..., and /var is a symlink to /private/var.
//
// Node reads TMPDIR (and TEMP/TMP on Windows) on every os.tmpdir() call, so
// setting them here fixes every temp directory the suite makes.
try {
  const canonical = NodeFS.realpathSync.native(NodeOS.tmpdir());
  process.env.TMPDIR = canonical;
  process.env.TEMP = canonical;
  process.env.TMP = canonical;
} catch {
  // Leave the host's value alone if it cannot be resolved.
}
