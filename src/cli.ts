#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { analyze } from "./analyze.js";
import {
  collectInterview,
  flagValue,
  INTERVIEW_VALUE_FLAGS,
} from "./interview.js";
import { renderReportJson } from "./json.js";
import { resolveLlmClient } from "./llm.js";
import { parseRepo } from "./parse.js";
import { renderReport } from "./render.js";
import { messageOf } from "./types.js";
import type { InterviewQuestion } from "./interview.js";
import type { LlmEnv } from "./llm.js";

const USAGE = `datashadow — a privacy-hygiene check for your JS/TS codebase.

Usage:
  datashadow [path]            Analyse the repo at [path] (default: current directory)
  datashadow --print-summary   Print the inspectable summary.json the tool built
                               from your code, instead of the report
  datashadow --json            Emit the report as machine-readable JSON (for CI)
                               instead of the human-readable report
  datashadow --help            Show this help

Interview (three business facts the code can't reveal, asked once). On a terminal
they're prompted for; supply them non-interactively for CI, or --no-interview to
skip prompting (unanswered facts stay "unknown"):
  --eu-uk-users <yes|no>       Do you have EU / UK users?
  --signed-dpas <yes|no>       Signed data-processing agreements with vendors?
  --sells-shares-data <yes|no> Do you run ads / sell or share data?
  --interview-file <path>      JSON file of the same answers (flags override it)
  --no-interview               Don't prompt; use only flags/file (rest "unknown")

Model provider (optional — the judgment checks reason over the summary.json,
never your source; skipped entirely when unset). Bring your own key against any
OpenAI-compatible endpoint, including a local model (Ollama/LM Studio):
  --llm-base-url <url>   or  DATASHADOW_LLM_BASE_URL
  --llm-model <name>     or  DATASHADOW_LLM_MODEL
  DATASHADOW_LLM_API_KEY   the API key (env only; omit for a local model)

The key is env-only by design: a flag would land in your shell history and the
process table (visible via \`ps\`), so it's never accepted on the command line.
`;

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
  const valueFlags = [
    "--llm-base-url",
    "--llm-model",
    ...INTERVIEW_VALUE_FLAGS,
  ];
  const consumed = new Set<number>();
  for (const flag of valueFlags) {
    const index = args.indexOf(flag);
    if (index !== -1) consumed.add(index).add(index + 1);
  }

  const positional = args.filter(
    (arg, index) => !arg.startsWith("-") && !consumed.has(index),
  );
  const repoPath = resolve(positional[0] ?? ".");

  // Route the pipeline's non-fatal warnings (see {@link Warn}) to stderr, so
  // stdout stays a clean report or JSON payload a pipe or CI step can consume
  // unpolluted.
  const warn = (message: string) => process.stderr.write(`datashadow: ${message}\n`);

  // --print-summary surfaces the Parse-stage output so a user can verify exactly
  // what was detected before trusting any finding.
  if (args.includes("--print-summary")) {
    const summary = await parseRepo(repoPath, warn);
    process.stdout.write(JSON.stringify(summary, null, 2) + "\n");
    return 0;
  }

  // Collect the interview once per run: flags/file first, then prompt on a TTY
  // for whatever's left (unless --no-interview). A non-interactive run leaves
  // unanswered facts "unknown", which the interview-conditioned checks treat as
  // "don't fire" — so CI never invents a finding it wasn't told about.
  const answers = await runInterview(args);

  // Resolve the model provider from flags/env; when unconfigured this is the
  // not-configured client and the judgment stage is skipped.
  const llmClient = resolveLlmClient(llmEnvFrom(args, process.env));
  const report = await analyze(repoPath, answers, llmClient, warn);

  // --json emits the same Report as a machine-readable payload for CI; the
  // human-readable report stays the default.
  if (args.includes("--json")) {
    process.stdout.write(renderReportJson(report) + "\n");
    return 0;
  }

  process.stdout.write(renderReport(report) + "\n");
  return 0;
}

/**
 * Drive {@link collectInterview} from the CLI environment: read an optional
 * `--interview-file`, and wire an interactive prompt only on a real terminal that
 * wasn't told to skip it. The readline interface is created lazily and closed
 * afterwards so a fully non-interactive run never touches stdin.
 */
async function runInterview(args: string[]) {
  const filePath = flagValue(args, "--interview-file");
  const fileContents = filePath
    ? await readFile(resolve(filePath), "utf8")
    : undefined;

  const interactive =
    !args.includes("--no-interview") &&
    Boolean(process.stdin.isTTY) &&
    Boolean(process.stdout.isTTY);

  if (!interactive) {
    return collectInterview({ args, fileContents });
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const ask = (question: InterviewQuestion) =>
      rl.question(`${question.prompt} [yes/no/unknown] `);
    return await collectInterview({ args, fileContents, ask });
  } finally {
    rl.close();
  }
}

main(process.argv)
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    process.stderr.write(`datashadow: ${messageOf(error)}\n`);
    process.exitCode = 1;
  });
