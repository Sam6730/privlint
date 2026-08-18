
<div align="center">

# 🛡️ privlint

### A privacy-hygiene linter for your JS/TS codebase

*Point it at your repo — it tells you, in plain English, where your code is quietly breaking privacy rules, why it matters, and the one-line fix.*

Privacy scanners are built for security engineers: walls of findings tagged with OWASP IDs and terms like "ROPA" and "DPIA". `privlint` is built for the founders who want one command — no config, no code changes, nothing leaving your machine.

```bash
npx privlint
```

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE) ![Node ≥ 18](https://img.shields.io/badge/Node-%E2%89%A5%2018-5FA04E?logo=nodedotjs&logoColor=white) ![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white) ![Next.js](https://img.shields.io/badge/Next.js-000000?logo=nextdotjs&logoColor=white) ![Express](https://img.shields.io/badge/Express-000000?logo=express&logoColor=white)

</div>

---

https://github.com/user-attachments/assets/683dce46-9bda-49fe-a234-afbc8de35d7d

<details>
<summary><b>Prefer text?</b> The same run, written out (the video above plays on GitHub).</summary>

**1. Run it.** No flags. It asks three questions the code can't answer, then prints a tight, ranked report:

```console
$ npx privlint ./my-app

Do you have users in the EU or UK? [yes/no/unknown]   yes
Have you signed DPAs with your vendors? [yes/no/...]   no
Do you run ads, or sell or share personal data? [...]  no

5 findings, most serious first:

[CRITICAL] Committed AWS access key ID in app/api/charge/route.ts:4   (secrets · checked in code)
[HIGH]     Card data (cardNumber) written to logs …                   (logging · checked in code)
[HIGH]     No signed DPAs, but the code sends data to Stripe          (dpa · you told us)
[HIGH]     Stripe isn't named as a processor in your privacy policy   (disclosure · reasoned about)
[MEDIUM]   Personal data (email) put in a URL …                       (urls · checked in code)
```

Every finding says **how it was determined** — `checked in code` / `you told us` / `reasoned about` — so you know how much to trust it, and it's ranked by how badly it can burn you, not by category. Each also prints a plain-English *why it matters* and a one-line *fix* (trimmed here).

**2. Don't trust it? Inspect what it saw** with `--print-summary` — the small, structured `summary.json` it reasons over (never your source code). The two `reasoned about` / `you told us` findings appear only when you configure a model provider; everything else works with zero AI.

**3. Run it on a clean repo — and it goes quiet.** No crying wolf:

```console
$ npx privlint ./clean-app

No findings. Nothing flagged in this run.
```

</details>

---

## Install & usage

No install needed: `npx` runs the latest published version:

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

**Three business facts the code can't reveal** are asked once per run (on a terminal) or supplied non-interactively for CI:

```bash
privlint --eu-uk-users yes --signed-dpas no --sells-shares-data no --no-interview
```

They condition which findings apply — e.g. CCPA "sell/share" duties only surface if you say you sell or share data.

---

## What it checks

Ranked by consequence.

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

The two `reasoned about` checks run only when you configure a model provider and everything else works with zero AI. Detection prefers a **curated SDK registry** (Stripe, Segment, Mixpanel, PostHog, OpenAI, …) over generic guessing.

## Bring your own model

The judgment checks work against any **OpenAI-compatible** `/chat/completions` endpoint — a hosted API or a fully local model (Ollama, LM Studio) at no cost:

```bash
export PRIVLINT_LLM_BASE_URL=http://localhost:11434/v1   # e.g. Ollama
export PRIVLINT_LLM_MODEL=llama3
# PRIVLINT_LLM_API_KEY is env-only by design — a flag would leak it into your
# shell history and the process table (`ps`). Omit it for a local model.
```

If the provider errors out (bad key, dead endpoint, timeout), the run **degrades gracefully**: the judgment check is skipped with a note on stderr and your deterministic findings are unaffected.

## Privacy & limits

- **Your source code never leaves your machine.** Only the small, inspectable `summary.json` is sent to the model provider *you* choose, with *your* key. Nothing is stored on the author's side so the tool is stateless.
- It's honest about what it **can't** see: your vendor contracts, data residency and whether a deletion path actually purges every store (it detects the *presence* of a path, not its completeness).
- It never auto-declares a legal verdict ("you are subject to GDPR", "you are selling data") and it never writes a privacy policy for you to publish.

> **This is a privacy-hygiene check, not legal advice.** It flags likely problems to get reviewed; it can't see your vendor contracts or data residency, and a clean result doesn't prove compliance. When in doubt, check with counsel.

## Scope

GDPR / UK GDPR (incl. PECR) / CCPA-CPRA data-privacy hygiene for JavaScript / TypeScript (Next.js, Node, Express). Future updates will include support for additional languages.

## License

[MIT](LICENSE) © Samarth Kapila. Original implementation — no derivation from Elastic-licensed or copyleft scanners.
