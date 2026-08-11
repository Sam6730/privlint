/**
 * Shared sensitivity classification for personal-data fields, used by the two
 * leak checks ({@link ./pii-logs} and {@link ./pii-sinks}).
 *
 * The parser only emits a {@link PiiSignal} for values it already recognises as
 * personal data, so a check never has to decide *whether* a field is personal —
 * only *how sensitive* it is, which sets the finding's severity and how bluntly
 * it's phrased. Three tiers, worst first:
 *
 * - `card`      — payment-card data (PAN, CVV). Carries PCI weight on top of the
 *                 general privacy harm, so it leads.
 * - `sensitive` — data whose exposure is directly damaging on its own
 *                 (credentials, government IDs).
 * - `personal`  — ordinary personal data (email, phone, address, name).
 *
 * The hint lists intentionally track a subset of the parser's `PII_SUBSTRINGS`:
 * the parser decides membership, this module only grades what it found.
 */
import type { Severity } from "../types.js";

/** How sensitive a leaked personal-data field is, worst first. */
export type FieldSensitivity = "card" | "sensitive" | "personal";

/** Normalized substrings that mark a field as payment-card data. */
const CARD_HINTS = ["creditcard", "cardnumber", "cardnum", "cvv"];

/**
 * Normalized substrings for data that is damaging on its own once exposed —
 * credentials and government identifiers — as opposed to ordinary personal data.
 */
const SENSITIVE_HINTS = [
  "password",
  "passwd",
  "ssn",
  "socialsecurity",
  "passport",
  "driverslicense",
  "driverlicense",
];

/** Severity and human-facing noun for each sensitivity tier. */
export const SENSITIVITY_META: Record<
  FieldSensitivity,
  { severity: Severity; noun: string }
> = {
  card: { severity: "high", noun: "Card data" },
  sensitive: { severity: "high", noun: "Sensitive personal data" },
  personal: { severity: "medium", noun: "Personal data" },
};

/**
 * Grade a personal-data field name into a {@link FieldSensitivity}. Matching is
 * done on the normalized name (lowercased, non-alphanumerics stripped) so
 * `cardNumber`, `card_number` and `CARD-NUMBER` all read the same.
 */
export function classifyPiiField(field: string): FieldSensitivity {
  const normalized = field.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (CARD_HINTS.some((hint) => normalized.includes(hint))) return "card";
  if (SENSITIVE_HINTS.some((hint) => normalized.includes(hint))) return "sensitive";
  return "personal";
}
