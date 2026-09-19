import * as Exit from "effect/Exit";
import * as Schema from "effect/Schema";

import { ItoProjectFile, ITO_PROJECT_FILE_SCHEMA_URL } from "@ito/contracts";

import { fromLenientJson } from "./schemaJson.ts";

/**
 * Codec between the raw `ito.json` file contents (lenient JSONC string) and the
 * decoded {@link ItoProjectFile}.
 */
export const ItoProjectFileFromJson = fromLenientJson(ItoProjectFile);

const decodeItoProjectFile = Schema.decodeExit(ItoProjectFileFromJson);

/**
 * Decode raw `ito.json` contents, treating invalid or malformed files as
 * absent. Clients use this to read optional defaults (scripts, thread env
 * mode) without surfacing decode errors to the user.
 */
export function parseItoProjectFile(contents: string): ItoProjectFile | null {
  const decoded = decodeItoProjectFile(contents);
  return Exit.isSuccess(decoded) ? decoded.value : null;
}

/**
 * Build the publishable JSON Schema document for `ito.json` (draft 2020-12).
 *
 * Served from the marketing site at {@link ITO_PROJECT_FILE_SCHEMA_URL} so
 * editors get LSP support via a `$schema` reference.
 */
export function buildItoProjectFileJsonSchema(): Record<string, unknown> {
  const document = Schema.toJsonSchemaDocument(ItoProjectFile);
  const jsonSchema: Record<string, unknown> = {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: ITO_PROJECT_FILE_SCHEMA_URL,
    ...document.schema,
  };
  if (document.definitions && Object.keys(document.definitions).length > 0) {
    jsonSchema.$defs = document.definitions;
  }
  return jsonSchema;
}
