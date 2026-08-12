/**
 * Test support: build a {@link Summary} with every field empty, overriding only
 * the ones a check test cares about.
 *
 * A `check(summary) → Finding[]` reads a single slice of the summary, so its
 * unit test wants an otherwise-empty summary with just that slice populated.
 * Centralising the empty shape here means a new {@link Summary} field is a
 * one-line edit, not a change to every check test.
 */
import type { Summary } from "../summary.js";

/** An empty summary, with `overrides` merged over the empty defaults. */
export function emptySummary(overrides: Partial<Summary> = {}): Summary {
  return {
    repoPath: ".",
    routes: [],
    schema: [],
    sdks: [],
    policyPages: { privacy: { present: false }, terms: { present: false } },
    piiSignals: [],
    secrets: [],
    ...overrides,
  };
}
