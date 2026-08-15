# privlint

**Point it at your JS/TS repo. It tells you — in plain English — where your code is quietly breaking privacy rules, why it matters, and the one-line fix.**

Privacy scanners are built for security engineers: walls of findings tagged with OWASP IDs and terms like "ROPA" and "DPIA," and half of them don't even speak Next.js. `privlint` is built for the founder who collects emails, runs payments through Stripe, pipes events into analytics, and has no idea which laws apply or where the code already trips them. One command, no config, no code changes, nothing leaves your machine.

```bash
npx privlint
```

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE) ![Node ≥ 18](https://img.shields.io/badge/Node-%E2%89%A5%2018-5FA04E?logo=nodedotjs&logoColor=white) ![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white) ![Next.js](https://img.shields.io/badge/Next.js-000000?logo=nextdotjs&logoColor=white) ![Express](https://img.shields.io/badge/Express-000000?logo=express&logoColor=white)

---

## 60-second demo

The scripted walkthrough below is the demo — four steps, real output, ending on silence. A screen recording of exactly this run will be linked here.

<!-- Author: record this walkthrough and embed it above as ![60-second demo](docs/demo.gif).
     Step-by-step recording instructions: docs/demo-recording.md -->


**1. Run it on a leaky repo.** No flags, no setup.

```console
$ npx privlint ./my-app

8 findings, most serious first:

[CRITICAL] Committed AWS access key ID in app/api/charge/route.ts:9 (AKIA…)  (secrets · checked in code)
  Why it matters: Anyone who can read this repo can use this AWS key to spin up
  resources on your account and run up the bill, or reach whatever data that
  account can touch.
  Fix: Remove it from the code and read it from an environment variable instead,
  then rotate the key in the AWS IAM console (treat the committed one as already
  compromised). Then purge it from your git history…

[HIGH]     Card data (cardNumber) written to logs in app/api/charge/route.ts:19  (logging · checked in code)
  Why it matters: Card data (`cardNumber`) is written to your logs… Storing card
  data in logs also breaks your PCI obligations.
  Fix: Remove `cardNumber` from the log call — log a non-identifying reference
  (an id, not the value) instead — and scrub it from any logs already retained.
…
```

Every finding says **how it was determined** (`checked in code` / `reasoned about` / `you told us`), so you know how much to trust it, and it's ranked by how badly it can burn you — not by category.

**2. Don't trust it? Inspect what it saw.** The tool reasons over a small, structured `summary.json` it builds from your code — not a black box:

```console
$ npx privlint ./my-app --print-summary

{
  "sdks": [
    { "package": "stripe",  "destination": "Stripe",  "dataCategory": "payment",   "called": true },
    { "package": "@segment/analytics-node", "destination": "Segment", "dataCategory": "analytics", "called": true }
  ],
  "policyPages": { "privacy": { "present": true }, "terms": { "present": false } },
  "piiSignals": [ { "kind": "log", "field": "email", "line": 19 }, … ]
}
```

**3. Add a model provider for the judgment checks.** Bring your own key (or a local model). The model only ever sees that `summary.json` — **never your source code** — and reasons about things a regex can't, like whether the vendors your code calls are actually named in your privacy policy:

```console
$ PRIVLINT_LLM_BASE_URL=https://api.openai.com/v1 \
  PRIVLINT_LLM_MODEL=gpt-4o-mini \
  PRIVLINT_LLM_API_KEY=sk-… \
  npx privlint ./my-app

[HIGH]     Stripe and Segment aren't named in your privacy policy  (disclosure · reasoned about)
  Why it matters: Your code sends card and event data to Stripe and Segment, but
  your policy names neither. If you have EU/UK users, undisclosed processors are a
  GDPR transparency gap — worth confirming with counsel.
  Fix: List Stripe and Segment as processors in your privacy policy and confirm a
  DPA is in place with each.
```

**4. Run it on a clean repo — and it goes quiet.** The single most important behaviour: no crying wolf.

```console
$ npx privlint ./clean-app

No findings. Nothing flagged in this run.
————
This is a privacy-hygiene check, not legal advice…
```

---

## Install & usage

No install needed — `npx` runs the latest published version:

```bash
npx privlint [path]      # defaults to the current directory
```

Or install it if you'll run it often:

```bash
npm install -g privlint
privlint ./my-app
```

| Command | What it does |
| --- | --- |
| `privlint [path]` | Analyse the repo and print the ranked, plain-language report |
| `privlint --print-summary` | Print the inspectable `summary.json` the tool built from your code |
| `privlint --json` | Emit the report as machine-readable JSON (for CI) |
| `privlint --help` | Full flag reference, including the interview and model-provider options |

**Three business facts the code can't reveal** are asked once per run (on a terminal), or supplied non-interactively for CI:

```bash
privlint --eu-uk-users yes --signed-dpas no --sells-shares-data no --no-interview
```

They condition which findings apply — e.g. CCPA "sell/share" duties only surface if you say you sell or share data.

---

## What it checks

Ranked by consequence, never by category. Category is a per-finding label.

| Check | Category | How it's determined |
| --- | --- | --- |
| Committed secrets / API keys (AWS, Stripe, Google, GitHub, private keys) | `secrets` | checked in code |
| PII or card data written to logs | `logging` | checked in code |
| PII in analytics event properties | `analytics` | checked in code |
| PII placed in URLs / query strings | `urls` | checked in code |
| Collects personal data but has no reachable `/privacy` page | `policy` | checked in code |
| No account-deletion path (right to erasure) | `deletion` | checked in code |
| No data-export/access path (right of access & portability) | `export` | checked in code |
| Undisclosed third-party processors — vendors your code calls vs. the ones your policy names (**code-vs-policy drift**) | `disclosure` | reasoned about |
| User data sent to an LLM API without disclosure or a lawful basis | `disclosure` | reasoned about |
| CCPA sell/share applicability | `disclosure` | you told us |
| A vendor-DPA gap | `disclosure` | you told us |

The two `reasoned about` checks run only when you configure a model provider; everything else works with zero AI. Detection prefers a **curated SDK registry** (Stripe, Segment, Mixpanel, PostHog, OpenAI, …) over generic guessing — narrow-and-reliable over broad-and-wrong, because a false positive is the one failure mode a non-expert can't catch.

## Bring your own model

The judgment checks work against any **OpenAI-compatible** `/chat/completions` endpoint — a hosted API or a fully local model (Ollama, LM Studio) at no cost:

```bash
export PRIVLINT_LLM_BASE_URL=http://localhost:11434/v1   # e.g. Ollama
export PRIVLINT_LLM_MODEL=llama3
# PRIVLINT_LLM_API_KEY is env-only by design — a flag would leak it into your
# shell history and the process table (`ps`). Omit it for a local model.
```

If the provider errors out (bad key, dead endpoint, timeout), the run **degrades gracefully**: the judgment check is skipped with a note on stderr and your deterministic findings are unaffected — judgment is best-effort, never the credibility floor.

## Privacy & limits

- **Your source code never leaves your machine.** Only the small, inspectable `summary.json` is sent to the model provider *you* choose, with *your* key. Nothing is stored on the author's side — the tool is stateless.
- It's honest about what it **can't** see: your vendor contracts, data residency, and whether a deletion path actually purges every store (it detects the *presence* of a path, not its completeness).
- It never auto-declares a legal verdict ("you are subject to GDPR", "you are selling data"), and it never writes a privacy policy for you to publish.

> **This is a privacy-hygiene check, not legal advice.** It flags likely problems to get reviewed; it can't see your vendor contracts or data residency, and a clean result doesn't prove compliance. When in doubt, check with counsel.

## Scope

GDPR / UK GDPR (incl. PECR) / CCPA-CPRA data-privacy hygiene, for JavaScript / TypeScript (Next.js, Node, Express). Out of scope: SOC 2, ISO 27001, general security posture, and other stacks (the `summary.json` schema is the language-agnostic seam for future extractors).

## License

[MIT](LICENSE) © Samarth Kapila. Original implementation — no derivation from Elastic-licensed or copyleft scanners.
