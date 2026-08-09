import { stat } from "node:fs/promises";

/**
 * Fail fast with a clear message unless `path` is an existing directory. `verb`
 * is the caller's action (e.g. "analyse", "parse") so the error reads naturally
 * from whichever stage rejected the path.
 */
export async function assertDirectory(path: string, verb: string): Promise<void> {
  let stats;
  try {
    stats = await stat(path);
  } catch {
    throw new Error(`Cannot ${verb} "${path}": no such file or directory.`);
  }
  if (!stats.isDirectory()) {
    throw new Error(`Cannot ${verb} "${path}": not a directory.`);
  }
}
