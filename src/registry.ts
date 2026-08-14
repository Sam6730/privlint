/**
 * The curated SDK registry: `package -> { data category, destination, why it
 * matters }`.
 *
 * This is the "narrow-and-reliable over broad-and-wrong" core of detection. We
 * only tag SDKs we've hand-verified, so a match is trustworthy rather than a
 * guess from a package name that merely looks data-related. Seeded with the
 * SaaS SDKs a small JS/TS founder is most likely to have wired in: Stripe,
 * Segment, Mixpanel, PostHog, and OpenAI. Adding a vendor is a one-line data
 * change, not new detection logic.
 */

import type { DataCategory } from "./summary.js";

/** One curated vendor entry, keyed by the npm package that imports it. */
export interface SdkRegistryEntry {
  /** The npm package specifier this entry matches (e.g. "stripe"). */
  package: string;
  /** What kind of data flows to this vendor. */
  dataCategory: DataCategory;
  /** Human-facing vendor name the data goes to. */
  destination: string;
  /** Why a founder should care that this data leaves for this vendor. */
  whyItMatters: string;
}

/**
 * The seeded registry. Multiple packages can map to the same destination (e.g.
 * server- and browser-side Stripe SDKs) so both import styles are detected.
 */
export const SDK_REGISTRY: readonly SdkRegistryEntry[] = [
  {
    package: "stripe",
    dataCategory: "payment",
    destination: "Stripe",
    whyItMatters:
      "Card and customer billing data is sent to Stripe, a third-party payment processor.",
  },
  {
    package: "@stripe/stripe-js",
    dataCategory: "payment",
    destination: "Stripe",
    whyItMatters:
      "Card and customer billing data is sent to Stripe, a third-party payment processor.",
  },
  {
    package: "@segment/analytics-node",
    dataCategory: "analytics",
    destination: "Segment",
    whyItMatters:
      "User events and traits are piped to Segment, which fans them out to other tools.",
  },
  {
    package: "@segment/analytics-next",
    dataCategory: "analytics",
    destination: "Segment",
    whyItMatters:
      "User events and traits are piped to Segment, which fans them out to other tools.",
  },
  {
    package: "analytics-node",
    dataCategory: "analytics",
    destination: "Segment",
    whyItMatters:
      "User events and traits are piped to Segment, which fans them out to other tools.",
  },
  {
    package: "mixpanel",
    dataCategory: "analytics",
    destination: "Mixpanel",
    whyItMatters:
      "User events and profile properties are sent to Mixpanel for product analytics.",
  },
  {
    package: "mixpanel-browser",
    dataCategory: "analytics",
    destination: "Mixpanel",
    whyItMatters:
      "User events and profile properties are sent to Mixpanel for product analytics.",
  },
  {
    package: "posthog-node",
    dataCategory: "analytics",
    destination: "PostHog",
    whyItMatters:
      "User events and person properties are sent to PostHog for product analytics.",
  },
  {
    package: "posthog-js",
    dataCategory: "analytics",
    destination: "PostHog",
    whyItMatters:
      "User events and person properties are sent to PostHog for product analytics.",
  },
  {
    package: "openai",
    dataCategory: "llm",
    destination: "OpenAI",
    whyItMatters:
      "Whatever you put in a prompt is sent to OpenAI; user data in prompts leaves your control.",
  },
];

/**
 * Look up the registry entry for an import specifier, or `undefined` if it isn't
 * a curated vendor. Subpath imports resolve to their package root, so
 * `import Stripe from "stripe/lib/..."` and `require("@segment/analytics-node")`
 * both match. Matching is exact on the package name — no fuzzy inference.
 */
export function lookupSdk(importSpecifier: string): SdkRegistryEntry | undefined {
  const pkg = packageRootOf(importSpecifier);
  if (pkg === undefined) return undefined;
  return SDK_REGISTRY.find((entry) => entry.package === pkg);
}

/**
 * Reduce an import specifier to its package root: the first path segment for an
 * unscoped package, the first two for a scoped one. Returns undefined for
 * relative or absolute paths, which are never registry vendors.
 */
function packageRootOf(importSpecifier: string): string | undefined {
  if (importSpecifier.startsWith(".") || importSpecifier.startsWith("/")) {
    return undefined;
  }
  const segments = importSpecifier.split("/");
  if (importSpecifier.startsWith("@")) {
    // Scoped package: "@scope/name" (guard against a bare "@scope").
    return segments.length >= 2 ? `${segments[0]}/${segments[1]}` : undefined;
  }
  return segments[0];
}
