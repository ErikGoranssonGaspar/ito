import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Schema from "effect/Schema";

import type { JoinPath } from "./DesktopStatePaths.ts";
import * as DesktopEnvironment from "./DesktopEnvironment.ts";

/**
 * A directory the T3 Code fork wrote to, paired with the Itô directory that
 * replaced it. The source is only ever read: the copy leaves it in place so a
 * migration that goes wrong can be undone by pointing the old app at it again.
 */
export interface StateMigration {
  readonly source: string;
  readonly target: string;
}

export class DesktopStateMigrationError extends Schema.TaggedError<DesktopStateMigrationError>()(
  "DesktopStateMigrationError",
  {
    source: Schema.String,
    target: Schema.String,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Failed to copy legacy state from "${this.source}" to "${this.target}".`;
  }
}

const BASE_DIR_NAME = ".ito";
const LEGACY_BASE_DIR_NAME = ".t3";

/**
 * The directories to carry over, in the order they should be tried. Electron's
 * user data moved twice upstream — an unpackaged `t3code` alongside a packaged
 * "T3 Code (Alpha)" — so the caller passes both and the first one that exists
 * wins.
 *
 * The base directory is carried over whenever it is one this app named itself:
 * `~/.ito`, or the `.ito` the dev runner pins to a checkout. Both were `.t3`
 * before the rebrand, so both have a counterpart to inherit. A base directory
 * the owner pointed somewhere else through `ITO_HOME` is left alone — it was
 * chosen deliberately and nothing renamed it.
 */
export function resolveStateMigrations(input: {
  readonly appDataDirectory: string;
  readonly userDataDirName: string;
  readonly legacyUserDataDirNames: ReadonlyArray<string>;
  readonly baseDir: string;
  readonly stateDir: string;
  readonly joinPath: JoinPath;
}): ReadonlyArray<StateMigration> {
  const userDataTarget = input.joinPath(input.appDataDirectory, input.userDataDirName);
  const userDataMigrations = input.legacyUserDataDirNames.map((legacyName) => ({
    source: input.joinPath(input.appDataDirectory, legacyName),
    target: userDataTarget,
  }));

  const parent = input.baseDir.slice(0, -BASE_DIR_NAME.length);
  const named = input.baseDir.endsWith(BASE_DIR_NAME) && /[/\\]$/.test(parent);
  const leaf = input.stateDir.slice(input.baseDir.length);
  if (!named || !input.stateDir.startsWith(input.baseDir) || leaf.length === 0) {
    return userDataMigrations;
  }

  return [
    ...userDataMigrations,
    { source: `${parent}${LEGACY_BASE_DIR_NAME}${leaf}`, target: input.stateDir },
  ];
}

/**
 * Copies each legacy directory that still has no Itô counterpart. Runs before
 * the single-instance lock, so nothing has the SQLite database open and a plain
 * recursive copy sees a consistent snapshot of it and its WAL sidecars.
 */
export const migrateLegacyState = Effect.gen(function* () {
  const environment = yield* DesktopEnvironment.DesktopEnvironment;
  const fileSystem = yield* FileSystem.FileSystem;

  const migrations = resolveStateMigrations({
    appDataDirectory: environment.appDataDirectory,
    userDataDirName: environment.userDataDirName,
    legacyUserDataDirNames: environment.legacyUserDataDirNames,
    baseDir: environment.baseDir,
    stateDir: environment.stateDir,
    joinPath: environment.path.join,
  });

  const migrated = new Set<string>();
  for (const migration of migrations) {
    if (migrated.has(migration.target)) {
      continue;
    }

    const failure = (cause: unknown) =>
      new DesktopStateMigrationError({
        source: migration.source,
        target: migration.target,
        cause,
      });

    const targetExists = yield* fileSystem.exists(migration.target).pipe(Effect.mapError(failure));
    if (targetExists) {
      migrated.add(migration.target);
      continue;
    }

    const sourceExists = yield* fileSystem.exists(migration.source).pipe(Effect.mapError(failure));
    if (!sourceExists) {
      continue;
    }

    yield* Effect.logInfo("Copying legacy T3 Code state to its Itô location").pipe(
      Effect.annotateLogs({ source: migration.source, target: migration.target }),
    );
    // Stage the copy beside the target and rename it into place, so a copy that
    // fails part way leaves no directory behind for the next start to mistake
    // for a finished migration.
    const staging = `${migration.target}.migrating`;
    yield* fileSystem
      .remove(staging, { recursive: true, force: true })
      .pipe(Effect.mapError(failure));
    yield* fileSystem.copy(migration.source, staging).pipe(
      Effect.tapCause(() =>
        fileSystem.remove(staging, { recursive: true, force: true }).pipe(Effect.ignore),
      ),
      Effect.mapError(failure),
    );
    yield* fileSystem.rename(staging, migration.target).pipe(Effect.mapError(failure));
    migrated.add(migration.target);
  }

  return migrations.filter((migration) => migrated.has(migration.target));
}).pipe(Effect.withSpan("desktop.stateMigration.migrateLegacyState"));
