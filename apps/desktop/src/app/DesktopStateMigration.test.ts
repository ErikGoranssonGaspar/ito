import * as NodePath from "@effect/platform-node/NodePath";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import * as DesktopConfig from "./DesktopConfig.ts";
import * as DesktopEnvironment from "./DesktopEnvironment.ts";
import * as DesktopStateMigration from "./DesktopStateMigration.ts";

const joinPath = (first: string, ...segments: string[]) =>
  [first, ...segments].join("/").replaceAll(/\/{2,}/g, "/");

describe("resolveStateMigrations", () => {
  const base = {
    appDataDirectory: "/Users/alice/Library/Application Support",
    userDataDirName: "ito",
    legacyUserDataDirNames: ["T3 Code (Alpha)", "t3code"],
    homeDirectory: "/Users/alice",
    stateDir: "/Users/alice/.ito/userdata",
    isBaseDirConfigured: false,
    joinPath,
  } as const;

  it("pairs every legacy userData directory with the Itô one", () => {
    const migrations = DesktopStateMigration.resolveStateMigrations(base);

    assert.deepEqual(migrations.slice(0, 2), [
      {
        source: "/Users/alice/Library/Application Support/T3 Code (Alpha)",
        target: "/Users/alice/Library/Application Support/ito",
      },
      {
        source: "/Users/alice/Library/Application Support/t3code",
        target: "/Users/alice/Library/Application Support/ito",
      },
    ]);
  });

  it("carries the state directory over from ~/.t3", () => {
    const migrations = DesktopStateMigration.resolveStateMigrations(base);

    assert.deepEqual(migrations.at(-1), {
      source: "/Users/alice/.t3/userdata",
      target: "/Users/alice/.ito/userdata",
    });
  });

  it("keeps the dev subdirectory distinct from the packaged one", () => {
    const migrations = DesktopStateMigration.resolveStateMigrations({
      ...base,
      userDataDirName: "ito-dev",
      legacyUserDataDirNames: ["t3code-dev"],
      stateDir: "/Users/alice/.ito/dev",
    });

    assert.deepEqual(migrations.at(-1), {
      source: "/Users/alice/.t3/dev",
      target: "/Users/alice/.ito/dev",
    });
  });

  it("leaves a configured base directory alone", () => {
    const migrations = DesktopStateMigration.resolveStateMigrations({
      ...base,
      isBaseDirConfigured: true,
      stateDir: "/repo/.ito/dev",
    });

    assert.equal(migrations.length, 2);
    assert.isTrue(
      migrations.every((migration) => migration.target.includes("Application Support")),
    );
  });
});

const withTempHome = <A, E, R>(
  use: (homeDirectory: string) => Effect.Effect<A, E, R | FileSystem.FileSystem | Path.Path>,
) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    // macOS hands out a /var symlink for the temp root and the migration compares
    // path prefixes, so start from the resolved directory.
    const homeDirectory = yield* fileSystem
      .makeTempDirectoryScoped({ prefix: "ito-desktop-state-migration-test-" })
      .pipe(Effect.flatMap((directory) => fileSystem.realPath(directory)));
    return yield* use(homeDirectory).pipe(Effect.provideService(Path.Path, path));
  }).pipe(Effect.provide(NodeServices.layer), Effect.scoped);

const runMigration = (homeDirectory: string) =>
  DesktopStateMigration.migrateLegacyState.pipe(
    Effect.provide(
      DesktopEnvironment.layer({
        dirname: `${homeDirectory}/app/dist-electron`,
        homeDirectory,
        platform: "darwin",
        processArch: "arm64",
        appVersion: "1.2.3",
        appPath: `${homeDirectory}/app`,
        isPackaged: true,
        resourcesPath: `${homeDirectory}/app/Resources`,
      }).pipe(
        Layer.provideMerge(
          Layer.mergeAll(NodeServices.layer, NodePath.layerPosix, DesktopConfig.layerTest({})),
        ),
      ),
    ),
  );

const pathJoin = (...segments: ReadonlyArray<string>) => segments.join("/");

describe("migrateLegacyState", () => {
  it.effect("copies T3 Code state across and leaves the original in place", () =>
    withTempHome((homeDirectory) =>
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const legacyStateDir = pathJoin(homeDirectory, ".t3", "userdata");
        yield* fileSystem.makeDirectory(legacyStateDir, { recursive: true });
        yield* fileSystem.writeFileString(
          pathJoin(legacyStateDir, "settings.json"),
          '{"kept":true}',
        );

        yield* runMigration(homeDirectory);

        const migratedPath = pathJoin(homeDirectory, ".ito", "userdata", "settings.json");
        assert.equal(yield* fileSystem.readFileString(migratedPath), '{"kept":true}');
        assert.isTrue(yield* fileSystem.exists(pathJoin(legacyStateDir, "settings.json")));
      }),
    ),
  );

  it.effect("never overwrites state Itô has already written", () =>
    withTempHome((homeDirectory) =>
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const legacyStateDir = pathJoin(homeDirectory, ".t3", "userdata");
        const stateDir = pathJoin(homeDirectory, ".ito", "userdata");
        yield* fileSystem.makeDirectory(legacyStateDir, { recursive: true });
        yield* fileSystem.writeFileString(
          pathJoin(legacyStateDir, "settings.json"),
          '{"stale":true}',
        );
        yield* fileSystem.makeDirectory(stateDir, { recursive: true });
        yield* fileSystem.writeFileString(pathJoin(stateDir, "settings.json"), '{"current":true}');

        yield* runMigration(homeDirectory);

        assert.equal(
          yield* fileSystem.readFileString(pathJoin(stateDir, "settings.json")),
          '{"current":true}',
        );
      }),
    ),
  );

  it.effect("does nothing when there is no legacy state", () =>
    withTempHome((homeDirectory) =>
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;

        yield* runMigration(homeDirectory);

        assert.isFalse(yield* fileSystem.exists(pathJoin(homeDirectory, ".ito")));
      }),
    ),
  );
});
