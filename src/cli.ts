#!/usr/bin/env node
import { resolve } from "node:path";
import { analyze } from "./analyze.js";
import { resolveLlmClient } from "./llm.js";
import { parseRepo } from "./parse.js";
import { renderReport } from "./render.js";
import { UNANSWERED_INTERVIEW } from "./types.js";
import type { LlmEnv } from "./llm.js";

const USAGE = `datashadow — a privacy-hygiene check for your JS/TS codebase.

Usage:
  datashadow [path]            Analyse the repo at [path] (default: current directory)
  datashadow --print-summary   Print the inspectable summary.json the tool built
                               from your code, instead of the report
  datashadow --help            Show this help

Model provider (optional — the judgment checks reason over the summary.json,
never your source; skipped entirely when unset). Bring your own key against any
OpenAI-compatible endpoint, including a local model (Ollama/LM Studio):
  --llm-base-url <url>   or  DATASHADOW_LLM_BASE_URL
  --llm-model <name>     or  DATASHADOW_LLM_MODEL
  DATASHADOW_LLM_API_KEY   the API key (env only; omit for a local model)

The key is env-only by design: a flag would land in your shell history and the
process table (visible via \`ps\`), so it's never accepted on the command line.
`;

/** Read `--flag value` from argv, returning undefined when the flag is absent. */
function flagValue(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index === -1) return undefined;
  return args[index + 1];
}

/**
 * Merge CLI flags over environment variables into the model-provider config.
 * Flags win so a one-off run can override an ambient environment — but only for
 * the non-secret settings. The API key is read from the environment only: a
 * flag would leak it into shell history and the process table (`ps`).
 */
function llmEnvFrom(args: string[], env: NodeJS.ProcessEnv): LlmEnv {
  return {
    DATASHADOW_LLM_BASE_URL:
      flagValue(args, "--llm-base-url") ?? env.DATASHADOW_LLM_BASE_URL,
    DATASHADOW_LLM_MODEL:
      flagValue(args, "--llm-model") ?? env.DATASHADOW_LLM_MODEL,
    DATASHADOW_LLM_API_KEY: env.DATASHADOW_LLM_API_KEY,
  };
}

async function main(argv: string[]): Promise<number> {
  const args = argv.slice(2);

  if (args.includes("--help") || args.includes("-h")) {
    process.stdout.write(USAGE);
    return 0;
  }

  // Flags that consume the following token as their value; that value must not
  // be mistaken for the positional repo path. (The API key is env-only, so it
  // never appears here.)
  const valueFlags = ["--llm-base-url", "--llm-model"];
  const consumed = new Set<number>();
  for (const flag of valueFlags) {
    const index = args.indexOf(flag);
    if (index !== -1) consumed.add(index).add(index + 1);
  }

  const positional = args.filter(
    (arg, index) => !arg.startsWith("-") && !consumed.has(index),
  );
  const repoPath = resolve(positional[0] ?? ".");

  // --print-summary surfaces the Parse-stage output so a user can verify exactly
  // what was detected before trusting any finding.
  if (args.includes("--print-summary")) {
    const summary = await parseRepo(repoPath);
    process.stdout.write(JSON.stringify(summary, null, 2) + "\n");
    return 0;
  }

  // Resolve the model provider from flags/env; when unconfigured this is the
  // not-configured client and the judgment stage is skipped. The interview
  // isn't wired yet, so pass the stable "everything unknown" default.
  const llmClient = resolveLlmClient(llmEnvFrom(args, process.env));
  const report = await analyze(repoPath, UNANSWERED_INTERVIEW, llmClient);

  process.stdout.write(renderReport(report) + "\n");
  return 0;
}

main(process.argv)
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`datashadow: ${message}\n`);
    process.exitCode = 1;
  });
