# Spec: Privacy Hygiene CLI

> Working title. An open-source CLI that scans a JavaScript/TypeScript codebase for
> data-privacy blind spots and reports them in plain language for a non-expert founder.
> Greenfield project — no prior codebase, glossary, or ADRs.

## Problem Statement

I'm a non-technical-about-compliance founder shipping a web app. I collect emails, run
payments through Stripe, pipe events into an analytics tool, and maybe call an LLM API —
and I have no idea which privacy laws apply to me or where my code already breaks them. The
existing scanners are built for security engineers: they hand me a wall of findings labelled
with OWASP IDs and terms like "ROPA" and "DPIA," assume I already know what a DPA is, and
several don't even support my Next.js/TypeScript stack. So I keep shipping, quietly exposed,
and I only find out something was wrong when Stripe freezes my account or a user files a
complaint.

## Solution

A single command I point at my repo. It parses my code into a small, inspectable summary of
what data I actually collect and where it goes, asks me three quick questions it can't answer
from code, and then tells me — in plain English — which privacy rules likely apply to me,
where my code breaks them, and what the one-line fix is. Every finding says *how* it was
determined ("we found this in your code" vs. "we reasoned about this" vs. "you told us this"),
ranked by how badly it could burn me. It never pretends to be my lawyer: it flags hygiene
problems and points me at what to get reviewed, and it never writes a privacy policy for me to
blindly publish. My source code never leaves my machine — only the small summary is sent to
the model provider I choose (with my own key), and nothing is stored on the tool author's side.

## User Stories

1. As a founder, I want to run one command against my repo, so that I get privacy findings
   without configuring anything.
2. As a founder, I want the tool to run with no code changes to my project, so that trying it
   costs me nothing.
3. As a founder, I want to run it with `npx` (no global install), so that I can try it in
   seconds.
4. As a founder, I want plain-English findings, so that I understand the problem without
   knowing legal or security jargon.
5. As a founder, I want each finding to state the concrete consequence (e.g. "Stripe can
   freeze your account"), so that I understand why it matters.
6. As a founder, I want each finding to include a specific, actionable fix, so that I know what
   to do next.
7. As a founder, I want findings ranked by severity/consequence, so that I fix the most
   dangerous things first.
8. As a founder, I want each finding labelled with how it was determined (checked in code /
   reasoned about / you told us), so that I know how much to trust it.
9. As a founder, I want to be told which privacy regimes likely apply to me (GDPR, UK GDPR,
   CCPA/CPRA), so that I know what I'm actually on the hook for.
10. As a founder, I want a committed secret/API key in my repo flagged, so that I can rotate it
    before it leaks user data.
11. As a founder, I want PII or card data written to logs flagged, so that I stop leaking
    sensitive data into log storage.
12. As a founder, I want to be told when I collect personal data but have no reachable privacy
    policy page, so that I add one before an app store or regulator requires it.
13. As a founder, I want to be told when my app has no account-deletion path, so that I can
    honour the right to erasure.
14. As a founder, I want to be told when my app has no data-export/access path, so that I can
    honour the right of access/portability.
15. As a founder, I want to be told when personal data appears in URLs or analytics event
    properties, so that I stop leaking it into logs, referrers, and third parties.
16. As a founder, I want the third-party services my code actually calls (Stripe, Segment,
    Mixpanel, PostHog, OpenAI, etc.) cross-checked against the processors my privacy policy
    names, so that I catch undisclosed data sharing (drift between code and policy).
17. As a founder, I want to be warned when my code sends user data to an LLM API without
    disclosure or a lawful basis, so that I address a risk I didn't know I had.
18. As a founder, I want to be asked whether I have EU/UK users, so that findings are
    conditioned on facts my code can't reveal.
19. As a founder, I want to be asked whether I have signed data-processing agreements with my
    vendors, so that the tool doesn't guess about contracts it can't see.
20. As a founder, I want to be asked whether I run ads / sell or share data, so that CCPA-only
    findings apply only when relevant.
21. As a founder, I want the three business-fact questions asked once at the start of a run, so
    that answering isn't a chore.
22. As a founder, I want a persistent "this is a hygiene check, not legal advice" disclaimer,
    so that I understand the tool's limits.
23. As a founder, I want the tool to be upfront about what it *cannot* see (vendor contracts,
    data residency, whether deletion truly purges everything), so that I don't over-trust a
    clean result.
24. As a founder, I want to inspect the `summary.json` the tool built from my code, so that I
    can verify what it detected and trust the reasoning.
25. As a founder, I want my source code to never leave my machine, so that I can run the tool
    on a private codebase safely.
26. As a founder, I want to supply my own model provider API key, so that I control cost and
    where the summary is sent.
27. As a founder, I want to point the tool at any OpenAI-compatible endpoint (including a local
    model like Ollama), so that I can keep inference fully local if I choose.
28. As a founder, I want the tool to store nothing on the author's servers, so that using it
    creates no new data-privacy exposure for me.
29. As a founder, I want a run on a clean codebase to return no findings, so that I trust the
    tool isn't crying wolf.
30. As a founder, I want machine-readable output (JSON) in addition to human-readable output,
    so that I can wire it into CI later.
31. As a founder on a Next.js / Node / Express stack, I want first-class support for my stack
    and the SaaS SDKs I actually use, so that I get real results instead of nothing.
32. As a founder, I want the tool to never auto-declare a legal verdict (e.g. "you are subject
    to GDPR", "you are selling data"), so that I'm not misled by false confidence.
33. As a founder, I want deletion/export findings to be honest that they only detect the
    *presence* of a path, not that it purges every store, so that I don't assume compliance.
34. As a recruiter/engineer evaluating the author, I want a clear README with a 60-second demo
    video, so that I understand the project without cloning it.
35. As a recruiter/engineer, I want to see that the LLM reasons over a structured summary
    rather than raw code, so that I recognise real engineering over an LLM wrapper.
36. As the tool author, I want the analysis pipeline behind one testable function, so that I can
    assert its behaviour against fixture repos.
37. As the tool author, I want the LLM client injected as a dependency, so that judgment checks
    are deterministic in tests.
38. As the tool author, I want three fixture repos (leaky, clean, middling), so that I can
    validate detection and guarantee the clean repo stays silent.
39. As the tool author, I want the clean-repo "no findings" result asserted in CI, so that a
    regression that introduces false positives fails the build.
40. As the tool author, I want a curated registry mapping known SDKs to data categories, so
    that detection is reliable rather than generically guessed.

## Implementation Decisions

**Scope & positioning**

- Regime scope is tight: **GDPR / UK GDPR (incl. PECR) / CCPA-CPRA data privacy only.** Explicitly
  out: SOC 2, ISO 27001, and general security posture except where a security fact is itself a
  privacy obligation (e.g. committed secrets → breach risk under GDPR Art. 32).
- Target stack: **JavaScript / TypeScript** (Next.js, Node, Express) first-class. Other stacks
  (e.g. Python) are deferred to v2 as pluggable per-language extractors behind the
  `summary.json` seam — see Out of Scope for rationale.
- The tool is a **hygiene check, not legal advice**, and never generates a ready-to-publish
  privacy policy. Policy-related findings flag *what a policy should mention*, not authored text.

**Architecture — three-stage pipeline**

- **Parse:** an AST-based parser (`ts-morph` / the TypeScript compiler API) resolves imports and
  call sites and, combined with a **curated SDK registry** (`package → { data category,
  destination, why it matters }`), produces a small structured `summary.json`: detected routes/
  endpoints, model/schema shape, third-party SDKs tagged by data category, presence of
  `/privacy` and `/terms`, and PII-flow signals. Detection is deterministic and prefers a
  curated registry over generic inference (narrow-and-reliable over broad-and-wrong).
- **Interview:** three business-fact questions asked once per run (EU/UK users? signed DPAs?
  sell/share/ads?). Answers condition which findings apply and soften phrasing. These are never
  auto-verdicted.
- **Reason:** the LLM is sent **only `summary.json` plus the interview answers — never raw
  source code.** It produces the judgment findings and the plain-language "consequence + fix"
  translation. The privacy claim is precise: *source code never leaves the machine; only the
  inspectable summary does.*

**Checks — 8 in v1, tagged by determination method, ranked by consequence**

- Deterministic (6): committed secrets/keys; PII/card data in logs; missing reachable
  `/privacy` page while collecting PII; missing account-deletion path; missing data-export/
  access path; PII in URLs or analytics event properties.
- Judgment / LLM-over-summary (2): undisclosed third-party processors (code-detected vendors
  diffed against privacy-policy text — this *is* the "drift" feature, not a separate module);
  user data sent to an LLM API without disclosure/basis.
- Deferred to v2: consent-gate-before-trackers; "Do Not Sell or Share" link; Global Privacy
  Control handling; pre-checked marketing-consent box.
- **Output ranking is by severity/consequence, not by category.** Category is surfaced as a
  per-finding label, not a sort key. Deterministic checks are the credibility floor; judgment
  checks are the differentiator; neither is ranked above the other by type.

**Findings must not state legal conclusions.** Deterministic checks may state facts ("X is in
your code"); judgment and business-fact items must be phrased as conditional risk plus a nudge
to verify with counsel. Presence-only checks (deletion/export) must caveat that they can't
verify completeness.

**Model provider**

- Bring-your-own-key against any **OpenAI-compatible endpoint** (base URL + model + key).
  Default to a hosted API; local models (Ollama/LM Studio) work for free via the same
  configurable endpoint. No bespoke local-model integration is built.

**Distribution & licensing**

- Runnable via `npx`; stateless; nothing persisted server-side by the author.
- Licensed **MIT or Apache-2.0**, with an original scanner implementation (no derivation from
  Elastic-licensed or copyleft competitors).

**Output**

- Two output modes: a human-readable report (default) and machine-readable JSON (for future CI
  use). A persistent not-legal-advice disclaimer is present in output.

## Testing Decisions

- **What a good test asserts here:** external behaviour of the pipeline — given a repo (and
  interview answers), the produced findings — not internal parser mechanics. Tests should read
  as "this repo produces these findings," and must not assert on private helper shapes.
- **Primary seam:** `analyze(repoPath, interviewAnswers, llmClient) → Report`, exercised
  **in-process** against fixture repos. Preferred over spawning the CLI binary (faster, same
  coverage). The CLI entry point is a thin wrapper over `analyze` and needs little direct
  testing.
- **Injected LLM client:** `analyze` takes the LLM client as a dependency. Tests pass a **fake**
  client so judgment checks are deterministic — assert both what summary/prompt is sent and how
  a canned model response maps to findings. No network calls in tests.
- **Pure-function unit seams (where they pay off):** `parseRepo(path) → summary` and each
  deterministic `check(summary) → Finding[]`, tested with small code snippets and the SDK
  registry (e.g. "this snippet imports and calls Stripe → detected as payment/third-party").
- **Fixture repos (integration + validation):** three committed fixtures — a **leaky** Next.js
  app (committed secret, PII in logs, no `/privacy`, Stripe + Segment wired), a **clean** app
  that must produce **zero** findings, and a **middling** one. Wire all into CI.
- **The clean repo's silence is a hard CI assertion:** a regression that introduces false
  positives fails the build. This is the single most important test — false positives are the
  one failure mode the target persona cannot catch.
- **Real open-source repos are for manual validation and demo footage only**, never the CI
  suite (they drift and have no ground truth).
- **Prior art:** none (greenfield). Establish the fixture-repo + injected-LLM pattern as the
  reference for future checks.

## Out of Scope

- Any regime beyond GDPR / UK GDPR / PECR / CCPA-CPRA (no SOC 2, ISO, HIPAA, PCI beyond the
  card-in-logs signal, or general security posture).
- Stacks other than JavaScript / TypeScript — **deferred to v2, not excluded permanently.**
  The `summary.json` schema is the language-agnostic seam: the LLM reasoning layer and all
  judgment checks operate on the summary, so adding a language means writing a new extractor
  (parser + curated registry + framework/ORM/log detection) that emits the same schema — a
  clean additive extension, not a rewrite. Kept out of v1 because a second extractor roughly
  doubles the hardest, most detail-heavy part of the work (and adds a cross-language runtime
  dependency) while adding no new reasoning capability, and because doing JS/TS excellently is
  a sharper story than covering two stacks shallowly.
- Generating a publishable privacy policy or any other legal document.
- Auto-rendering legal verdicts ("you are subject to GDPR," "you are selling data").
- A hosted web playground / server (the "hosted demo" is a README screen recording, not real
  infrastructure).
- Bespoke local-model integration (covered for free by the OpenAI-compatible endpoint option).
- The v2 checks listed above (consent gate, Do-Not-Sell link, GPC, pre-checked consent).
- Storing or transmitting anything to the tool author's infrastructure.
- Verifying that a deletion/export path actually purges/returns *all* data (presence detection
  only).

## Further Notes

- **Naming:** the product name is still open ("Privacy Hygiene CLI" is a placeholder).
- **Portfolio intent:** this is a personal portfolio project (resume + GitHub stars), optimized
  for recruiter comprehension and genuine usefulness. The README is effectively the product for
  the ~95% who won't clone it: hero sentence → 60-second demo video (run on the leaky repo, show
  `summary.json`, a deterministic scare, a labelled judgment finding) → **end on the clean repo
  returning nothing** → check table with category labels → install + disclaimer.
- **IP / timing:** the author has a software internship starting early September; the
  substantive, resume-worthy version should be public and committed before it starts. The
  employment IP/side-project clause has been reviewed.
- **Build sequence:** Week 1 — parser + `summary.json` + 6 deterministic checks + 3 fixtures +
  CI (a working tool with zero AI). Week 2 — LLM client + 2 judgment checks + plain-language
  voice + 3-question interview + disclaimer. Week 3 — README, demo video, `npx`, error handling,
  publish, with buffer. Deterministic-first is a *de-risking* order only; it does not weight
  deterministic findings above judgment findings in the product.
- **Competitive context:** distinct from Bearer (Elastic-licensed, engineer-facing, OWASP/CWE
  jargon), Privado (Java/Python OSS, privacy-engineer-facing, generates disclosure artifacts but
  not policy drift for solo founders), and Comp AI (SOC 2 / policy automation over typed facts,
  not a code scanner). The unclaimed seam this owns: plain-language, code-grounded privacy
  hygiene for the non-expert founder, including code-vs-policy processor drift.
