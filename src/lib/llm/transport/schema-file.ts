// A JSON Schema handed to an agent CLI as a FILE (codex `--output-schema <FILE>`), never as argv
// text. Inlining a real schema through the shell:true spawn door is two hazards at once: cmd.exe
// caps a command line at 8191 characters (the assessment schema alone is several KB), and the shell
// re-parses every quote and brace in it. A path is short and needs one pair of quotes.
//
// The file lives in a fresh mkdtemp directory under os.tmpdir() (never the repo or the scanned
// workspace), is written owner-only where the platform honours POSIX modes (mkdtemp's 0700 dir +
// a 0600 file; Windows ignores the bits and the per-user temp dir carries the ACL instead), and the
// directory is removed in a `finally` however the run ends: success, CLI failure, timeout, abort.

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** A path the shell passes through verbatim inside double quotes, on cmd.exe AND POSIX sh. Allowed:
 *  letters and digits in any script (a Windows profile dir is named after its user, "Kazďa" or
 *  "José"), spaces, parentheses ("Program Files (x86)"), an apostrophe ("O'Brien") and plain
 *  punctuation. Absent on purpose: `"`, `%`/`!` (cmd expansion), `$`/backtick (sh expansion),
 *  `&|<>^` and control characters. */
const SHELL_SAFE_PATH_RE = /^[\p{L}\p{N} _.:\\/()~'+,=@#[\]{}-]+$/u;

/** The temp root cannot carry a schema path through the shell safely. A typed error so the adapter
 *  reports it as configuration, not as a CLI failure. */
export class SchemaFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SchemaFileError";
  }
}

/**
 * Write `schema` to a unique temp file, call `withFile(quotedPath, path)` (quotedPath is ready for a
 * shell:true argv), and remove the file and its directory afterwards whatever happened. `root` is a
 * test seam; production always passes the default.
 */
export async function withSchemaFile<T>(
  schema: object,
  withFile: (quotedPath: string, path: string) => Promise<T>,
  root: string = tmpdir(),
): Promise<T> {
  // Checked BEFORE anything is created: mkdtemp only appends [A-Za-z0-9], so a safe root is a safe path.
  if (!SHELL_SAFE_PATH_RE.test(join(root, "ascent-schema-XXXXXX", "schema.json"))) {
    throw new SchemaFileError(
      `The temp directory "${root}" contains characters the CLI's shell would re-interpret; set TMPDIR/TEMP to a plain path to use schema-constrained output.`,
    );
  }
  const dir = await mkdtemp(join(root, "ascent-schema-"));
  try {
    const path = join(dir, "schema.json");
    await writeFile(path, JSON.stringify(schema), { mode: 0o600, flag: "wx" });
    return await withFile(`"${path}"`, path);
  } finally {
    // Best effort, never masking the run's own outcome. maxRetries covers a Windows child that was
    // just SIGKILLed on timeout and has not released its handle yet (EBUSY/EPERM).
    await rm(dir, { recursive: true, force: true, maxRetries: 3 }).catch(() => {});
  }
}
