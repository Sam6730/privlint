/**
 * The committed-secrets check: turn the {@link Summary}'s detected secrets into
 * ranked {@link Finding}s. This is the first deterministic `check(summary) →
 * Finding[]` — a pure mapping with no I/O, so it's unit-testable against a
 * hand-built summary and reused unchanged behind {@link analyze}.
 *
 * A committed secret is a fact the parser found in the source, so these findings
 * are labelled `checked-in-code` and may state the leak plainly. The one hedge
 * is `generic-api-key`: the generic detector is less certain a value is live, so
 * its consequence is phrased conditionally.
 */
import type { Finding } from "../types.js";
import type { SecretKind, Summary } from "../summary.js";

/** Per-kind copy: what the credential is, how bad it is, and why it matters. */
interface SecretMeta {
  /** Human-facing name of the credential (e.g. "AWS access key ID"). */
  label: string;
  severity: Finding["severity"];
  /** Concrete consequence in the founder's terms. */
  consequence: string;
  /** Specific next step, including where to rotate. */
  fix: string;
}

const PURGE =
  "Then purge it from your git history so it can't be recovered from old commits.";

/**
 * The standard remediation for a provider credential: pull it out of the code,
 * read it from the environment, and rotate it at the provider. `rotation` is the
 * provider-specific clause (which console, what verb).
 */
const rotateFix = (rotation: string) =>
  `Remove it from the code and read it from an environment variable instead, then ${rotation} (treat the committed one as already compromised). ${PURGE}`;

const SECRET_META: Record<SecretKind, SecretMeta> = {
  "aws-access-key-id": {
    label: "AWS access key ID",
    severity: "critical",
    consequence:
      "Anyone who can read this repo can use this AWS key to spin up resources on your account and run up the bill, or reach whatever data that account can touch.",
    fix: rotateFix("rotate the key in the AWS IAM console"),
  },
  "stripe-secret-key": {
    label: "Stripe secret key",
    severity: "critical",
    consequence:
      "Anyone who can read this repo can use this live Stripe key to charge cards, issue refunds, and pull your customer list — and Stripe may freeze your account once it detects the exposure.",
    fix: rotateFix("roll the key in the Stripe dashboard"),
  },
  "google-api-key": {
    label: "Google API key",
    severity: "critical",
    consequence:
      "Anyone who can read this repo can use this Google API key to call services billed to your account and burn through your quota.",
    fix: rotateFix("regenerate the key in the Google Cloud console"),
  },
  "github-token": {
    label: "GitHub token",
    severity: "critical",
    consequence:
      "Anyone who can read this repo can use this GitHub token to act as you — reading private repos and pushing code — with your access.",
    fix: rotateFix("revoke the token in your GitHub settings and issue a new one"),
  },
  "private-key": {
    label: "private key",
    severity: "critical",
    consequence:
      "Anyone who can read this repo has this private key, and can decrypt traffic or sign and impersonate your service wherever the key is trusted.",
    fix: `Remove it from the code and load it from a secret store or environment variable instead, then rotate the key pair wherever it's used (treat the committed one as already compromised). ${PURGE}`,
  },
  "generic-api-key": {
    label: "API key or secret",
    severity: "high",
    consequence:
      "A value that looks like an API key or secret is committed here. If it's a live credential, anyone who can read this repo can use it to act as your app against that service.",
    fix: `Remove it from the code and read it from an environment variable instead. If it's a real credential, rotate it at the provider and treat the committed one as compromised. ${PURGE}`,
  },
};

/** Map every committed secret in the summary to a `checked-in-code` finding. */
export function checkCommittedSecrets(summary: Summary): Finding[] {
  return summary.secrets.map((secret) => {
    const meta = SECRET_META[secret.kind];
    return {
      id: "committed-secrets",
      title: `Committed ${meta.label} in ${secret.file}:${secret.line} (${secret.preview})`,
      severity: meta.severity,
      category: "secrets",
      determination: "checked-in-code",
      consequence: meta.consequence,
      fix: meta.fix,
    };
  });
}
