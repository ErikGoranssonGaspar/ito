import {
  ITO_PROJECT_FILE_NAME,
  type EnvironmentId,
  type ItoProjectFile,
  type ItoProjectFileScript,
} from "@ito/contracts";
import { parseItoProjectFile } from "@ito/shared/itoProjectFile";
import { useMemo } from "react";

import { useProjectFileQuery } from "~/components/files/projectFilesQueryState";

const NO_SCRIPTS: ReadonlyArray<ItoProjectFileScript> = [];

export interface ItoProjectFileState {
  /**
   * - `valid`: ito.json exists and decoded.
   * - `invalid`: ito.json exists but fails to decode (the server then ignores
   *   the whole file, including `iconPath` and every script).
   * - `missing`: no readable ito.json at the workspace root.
   * - `loading`: the file query has not settled yet.
   */
  status: "loading" | "missing" | "invalid" | "valid";
  /** The decoded file when status is `valid`, null otherwise. */
  file: ItoProjectFile | null;
  scripts: ReadonlyArray<ItoProjectFileScript>;
}

/**
 * Decoded state of the project's checked-in `ito.json`, including whether the
 * file exists but is broken — which the runtime otherwise swallows silently.
 */
export function useItoProjectFileState(
  environmentId: EnvironmentId,
  cwd: string | null,
): ItoProjectFileState {
  const query = useProjectFileQuery(environmentId, cwd ?? "", ITO_PROJECT_FILE_NAME, cwd !== null);
  const contents = query.data && !query.data.truncated ? query.data.contents : null;
  const isPending = query.isPending;
  return useMemo(() => {
    if (contents === null) {
      return {
        status: isPending ? "loading" : "missing",
        file: null,
        scripts: NO_SCRIPTS,
      } as const;
    }
    const file = parseItoProjectFile(contents);
    if (file === null) {
      return { status: "invalid", file: null, scripts: NO_SCRIPTS } as const;
    }
    return { status: "valid", file, scripts: file.scripts ?? NO_SCRIPTS } as const;
  }, [contents, isPending]);
}

/**
 * Scripts declared in the project's checked-in `ito.json`, offered in the
 * scripts menu for import. Missing, truncated, or invalid files resolve to
 * an empty list.
 */
export function useItoProjectFileScripts(
  environmentId: EnvironmentId,
  cwd: string | null,
): ReadonlyArray<ItoProjectFileScript> {
  return useItoProjectFileState(environmentId, cwd).scripts;
}
