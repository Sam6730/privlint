# privlint

**Point it at your JS/TS repo. It tells you — in plain English — where your code is quietly breaking privacy rules, why it matters, and the one-line fix.**

Privacy scanners are built for security engineers: walls of findings tagged with OWASP IDs and terms like "ROPA" and "DPIA," and half of them don't even speak Next.js. `privlint` is built for the founder who collects emails, runs payments through Stripe, pipes events into analytics, and has no idea which laws apply or where the code already trips them. One command, no config, no code changes, nothing leaves your machine.

```bash
npx privlint
```

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE) ![Node ≥ 18](https://img.shields.io/badge/Node-%E2%89%A5%2018-5FA04E?logo=nodedotjs&logoColor=white) ![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white) ![Next.js](https://img.shields.io/badge/Next.js-000000?logo=nextdotjs&logoColor=white) ![Express](https://img.shields.io/badge/Express-000000?logo=express&logoColor=white)

---

![60-second demo](assets/demo.gif)

Three beats — run it, inspect what it saw, watch it go quiet on a clean repo. The written walkthrough below mirrors the recording.

**1. Run it.** No flags, no setup. It asks three questions the code can't answer, then prints a tight, ranked report:

```console
$ npx privlint ./my-app

Do you have users in the EU or UK? [yes/no/unknown]                        yes
Have you signed data-processing agreements (DPAs) with your vendors? [...]  no
Do you run ads, or sell or share personal data? [yes/no/unknown]           no

5 findings, most serious first:

[CRITICAL] Committed AWS access key ID in app/api/charge/route.ts:4 (AKIA…)  (secrets · checked in code)
  Why it matters: Anyone who can read this repo can use this AWS key to spin up
  resources on your account and run up the bill, or reach whatever data that
  account can touch.
  Fix: Remove it from the code and read it from an environment variable instead,
  then rotate the key in the AWS IAM console (treat the committed one as already
  compromised). Then purge it from your git history so it can't be recovered.

[HIGH]     Card data (cardNumber) written to logs in app/api/charge/route.ts:12  (logging · checked in code)
  Why it matters: Card data (`cardNumber`) is written to your logs, which get
  shipped to third-party log services and retained for months. Storing card data
  in logs also breaks your PCI obligations.
  Fix: Remove `cardNumber` from the log call — log a non-identifying reference
  (an id, not the value) instead — and scrub it from any logs already retained.

[HIGH]     You told us there are no signed DPAs, but the code sends data to third-party vendors  (dpa · you told us)
  Why it matters: You said you haven't signed DPAs with your vendors, and the code
  sends data to Stripe. Without one, that data sharing may lack a lawful basis
  (GDPR Art. 28 / CCPA service-provider terms).
  Fix: Put a signed DPA in place with each vendor that processes personal data on
  your behalf — most major vendors offer a standard one.

[HIGH]     Stripe isn't named as a processor in your privacy policy  (disclosure · reasoned about)
  Why it matters: Your code sends payment data to Stripe, but your policy doesn't
  name it. For EU/UK users, an undisclosed processor is a GDPR transparency gap.
  Fix: List Stripe as a processor in your privacy policy.

[MEDIUM]   Personal data (email) put in a URL in app/api/charge/route.ts:15  (urls · checked in code)
  Why it matters: URLs leak — they land in server access logs, browser history,
  and the Referer header sent to third parties.
  Fix: Move `email` out of the URL and into the request body (or drop it).
```

Every finding says **how it was determined** — `checked in code` / `you told us` / `reasoned about` — so you know how much to trust it, and it's ranked by how badly it can burn you, not by category.

**2. Don't trust it? Inspect what it saw.** The tool reasons over a small, structured `summary.json` it builds from your code — not a black box:

```console
$ npx privlint ./my-app --print-summary

{
  "sdks": [
    { "package": "stripe", "destination": "Stripe", "dataCategory": "payment", "called": true }
  ],
  "policyPages": { "privacy": { "present": true }, "terms": { "present": false } },
  "piiSignals": [
    { "kind": "log", "field": "cardNumber", "line": 12 },
    { "kind": "url", "field": "email", "line": 15 }
  ],
  "secrets": [ { "kind": "aws-access-key-id", "line": 4, "preview": "AKIA…" } ]
}
```

The two `reasoned about` findings above (the DPA gap is `you told us`; the Stripe-vs-policy drift is `reasoned about`) appear only when you configure a model provider — and the model only ever sees this `summary.json`, **never your source code**. Everything else works with zero AI.

**3. Run it on a clean repo — and it goes quiet.** The single most important behaviour: no crying wolf.

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
