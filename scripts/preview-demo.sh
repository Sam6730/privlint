#!/usr/bin/env bash
#
# preview-demo.sh — dry-run the demo's OUTPUT so you can eyeball the colors and
# the curated finding set BEFORE you record the real (live) take.
#
# This is NOT the recording. The real demo is recorded live so the interactive
# questionnaire shows on screen (see docs/demo-recording.md). This preview runs
# the interview non-interactively (via flags) so nothing blocks, and forces color
# on so you can see it even though output isn't a bare TTY here.
#
# Beat 3 (the "reasoned about" Stripe drift finding) only appears if a model
# provider is configured in the environment:
#     export PRIVLINT_LLM_BASE_URL=https://api.openai.com/v1
#     export PRIVLINT_LLM_MODEL=gpt-4o-mini
#     export PRIVLINT_LLM_API_KEY=sk-...

set -uo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"

CLI="node $root/dist/cli.js"

printf '\n\033[1m# 1. Run it — the report (questionnaire is shown live in the real take)\033[0m\n\n'
FORCE_COLOR=1 $CLI demo/my-app \
  --no-interview --eu-uk-users yes --signed-dpas no --sells-shares-data no

printf '\n\033[1m# 2. Inspect what it reasoned over\033[0m\n\n'
$CLI demo/my-app --print-summary | head -n 24

printf '\n\033[1m# 3. A clean repo goes quiet\033[0m\n\n'
FORCE_COLOR=1 $CLI demo/clean-app --no-interview

printf '\n'
