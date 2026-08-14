#!/usr/bin/env node
import { resolve } from "node:path";
import { analyze } from "./analyze.js";
import { notConfiguredLlmClient } from "./llm.js";
import { parseRepo } from "./parse.js";
import { renderReport } from "./render.js";
import { UNANSWERED_INTERVIEW } from "./types.js";

const USAGE = `datashadow — a privacy-hygiene check for your JS/TS codebase.

Usage:
  datashadow [path]            Analyse the repo at [path] (default: current directory)
  datashadow --print-summary   Print the inspectable summary.json the tool built
                               from your code, instead of the report
  datashadow --help            Show this help
`;

async function main(argv: string[]): Promise<number> {
  const args = argv.slice(2);

  if (args.includes("--help") || args.includes("-h")) {
    process.stdout.write(USAGE);
    return 0;
  }

  const positional = args.filter((arg) => !arg.startsWith("-"));
  const repoPath = resolve(positional[0] ?? ".");

  // --print-summary surfaces the Parse-stage output so a user can verify exactly
  // what was detected before trusting any finding.
  if (args.includes("--print-summary")) {
    const summary = await parseRepo(repoPath);
    process.stdout.write(JSON.stringify(summary, null, 2) + "\n");
    return 0;
  }

  // The interview and model provider aren't wired yet; pass stable defaults so
  // the analyze seam stays fixed as later tickets fill them in.
  const report = await analyze(
    repoPath,
    UNANSWERED_INTERVIEW,
    notConfiguredLlmClient,
  );

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
