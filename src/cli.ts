#!/usr/bin/env node
import { resolve } from "node:path";
import { analyze } from "./analyze.js";
import { notConfiguredLlmClient } from "./llm.js";
import { renderReport } from "./render.js";
import { UNANSWERED_INTERVIEW } from "./types.js";

const USAGE = `datashadow — a privacy-hygiene check for your JS/TS codebase.

Usage:
  datashadow [path]     Analyse the repo at [path] (default: current directory)
  datashadow --help     Show this help
`;

async function main(argv: string[]): Promise<number> {
  const args = argv.slice(2);

  if (args.includes("--help") || args.includes("-h")) {
    process.stdout.write(USAGE);
    return 0;
  }

  const positional = args.filter((arg) => !arg.startsWith("-"));
  const repoPath = resolve(positional[0] ?? ".");

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
