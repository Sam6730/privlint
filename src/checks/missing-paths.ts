/**
 * The missing-path checks: three deterministic "a required page/path is absent"
 * findings, each a pure `check(summary) → Finding[]` like the other checks.
 *
 * Where the leak checks fire on something *present* in the source (a logged
 * value, a committed key), these fire on an *absence* — no reachable `/privacy`
 * page, no account-deletion path, no data-export/access path. The absence is
 * still a fact the parser established from the code, so they're labelled
 * `checked-in-code`.
 *
 * Two honesty constraints shape the phrasing:
 *
 * - **Conditioned on collecting personal data.** A duty to publish a privacy
 *   notice, to erase on request, or to hand back data only exists once the app
 *   actually holds personal data. So all three gate on
 *   {@link collectsPersonalData}; a repo that touches no personal data is silent
 *   (this is also what keeps the clean fixture silent even though it ships no
 *   deletion/export path).
 * - **Presence-only.** These checks look for the *presence* of a matching path,
 *   never that it truly purges or returns *all* of a user's data. The
 *   deletion/export findings say so outright, so a founder who adds a stub route
 *   doesn't read silence as "done."
 */
import type { Finding } from "../types.js";
import type { Route, Summary } from "../summary.js";
import { isPiiName } from "../parse.js";

/**
 * Whether the repo collects or stores personal data — the precondition for all
 * three duties. True when the parser saw any personal-data flow (a
 * {@link PiiSignal}), or when a stored model declares a personal-data field.
 */
export function collectsPersonalData(summary: Summary): boolean {
  if (summary.piiSignals.length > 0) return true;
  return summary.schema.some((model) => model.fields.some(isPiiName));
}

/**
 * A data-subject noun: the thing a rights path acts on. Requiring one alongside
 * a verb keeps `/delete-comment` or `/early-access` from reading as an erasure
 * or export path — they act on content, not on the user's personal data.
 */
const DATA_SUBJECT = /account|profile|user|member|customer|\bme\b|gdpr|ccpa|data|privacy/;

/**
 * The account/user record itself — the target a bare `DELETE` handler erases.
 * Narrower than {@link DATA_SUBJECT}: a `DELETE /api/gdpr-settings` isn't an
 * account-erasure endpoint, so the DELETE-method shortcut wants only these.
 */
const ACCOUNT_SUBJECT = /account|profile|\buser\b|users|\bme\b/;

/** Verbs that name a right-to-erasure action. */
const DELETION_VERB = /delete|remove|erase|erasure|deletion|close|closure/;

/** Verbs that name a data-export / right-to-access action. */
const EXPORT_VERB = /export|download|takeout|access/;

/** Whether any reachable route offers an account/data deletion path. */
function hasDeletionPath(routes: readonly Route[]): boolean {
  return routes.some((route) => {
    const path = route.path.toLowerCase();
    if (DELETION_VERB.test(path) && DATA_SUBJECT.test(path)) return true;
    // A DELETE handler aimed at the account/user itself is an erasure path even
    // without a deletion verb in the URL (e.g. `DELETE /api/account`).
    return route.method === "DELETE" && ACCOUNT_SUBJECT.test(path);
  });
}

/** Whether any reachable route offers a data-export / access path. */
function hasExportPath(routes: readonly Route[]): boolean {
  return routes.some((route) => {
    const path = route.path.toLowerCase();
    // A bare subject-access-request endpoint counts on its own.
    if (/dsar|subject[-_]?access/.test(path)) return true;
    return EXPORT_VERB.test(path) && DATA_SUBJECT.test(path);
  });
}

/**
 * The presence-only caveat, parameterised by what the path is meant to do.
 * Adding a matching path clears the finding, but the check can only confirm the
 * path *exists*, never that it does its job — so the copy says exactly that.
 */
const presenceOnly = (does: string) =>
  `This check only looks for the presence of such a path — it can't confirm it actually ${does}, so verify that yourself.`;

/**
 * Build a "missing rights path" finding. The deletion and export checks share
 * this shape (both `medium`, both `checked-in-code`, both presence-only),
 * differing only in the copy passed here.
 */
function missingRightsPath(o: {
  id: string;
  title: string;
  category: string;
  consequence: string;
  /** The remediation sentence, before the presence-only caveat. */
  remediation: string;
  /** What a present path is meant to do, for {@link presenceOnly}. */
  caveatAction: string;
}): Finding {
  return {
    id: o.id,
    title: o.title,
    severity: "medium",
    category: o.category,
    determination: "checked-in-code",
    consequence: o.consequence,
    fix: `${o.remediation} ${presenceOnly(o.caveatAction)}`,
  };
}

/** Flag collecting personal data with no reachable `/privacy` page. */
export function checkMissingPrivacyPage(summary: Summary): Finding[] {
  if (!collectsPersonalData(summary) || summary.policyPages.privacy.present) return [];
  return [
    {
      id: "missing-privacy-page",
      title: "No reachable /privacy page, but the app collects personal data",
      severity: "high",
      category: "policy",
      determination: "checked-in-code",
      consequence:
        "The app collects personal data but exposes no privacy-policy page. A notice at collection is a baseline requirement (GDPR Arts. 13–14, CCPA notice-at-collection), and app stores and browsers reject or warn on apps without one — so this blocks launch and erodes user trust before any regulator is involved.",
      fix: "Add a reachable /privacy page that says what personal data you collect, why, and who you share it with. This check only confirms such a page exists, not that its contents are accurate — keep it truthful and up to date.",
    },
  ];
}

/** Flag no right-to-erasure (account/data deletion) path (presence-only). */
export function checkMissingDeletionPath(summary: Summary): Finding[] {
  if (!collectsPersonalData(summary) || hasDeletionPath(summary.routes)) return [];
  return [
    missingRightsPath({
      id: "missing-deletion-path",
      title: "No account-deletion path for the personal data the app collects",
      category: "deletion",
      consequence:
        "The app collects personal data but exposes no way to delete an account or erase a user's data. Right-to-erasure requests (GDPR Art. 17, CCPA deletion) then have to be handled by hand, which is slow, error-prone, and easy to miss — and app stores increasingly require an in-app deletion path.",
      remediation: "Add an account-deletion / data-erasure path users can reach.",
      caveatAction: "erases every copy of the user's personal data",
    }),
  ];
}

/** Flag no data-export / right-to-access path (presence-only). */
export function checkMissingExportPath(summary: Summary): Finding[] {
  if (!collectsPersonalData(summary) || hasExportPath(summary.routes)) return [];
  return [
    missingRightsPath({
      id: "missing-export-path",
      title: "No data-export/access path for the personal data the app collects",
      category: "export",
      consequence:
        "The app collects personal data but exposes no way for a user to export or access the data you hold on them. Right-to-access / portability requests (GDPR Arts. 15 & 20, CCPA access) then fall to manual work, which is slow and easy to get wrong under a response deadline.",
      remediation: "Add a data-export / access path users can reach.",
      caveatAction: "returns all of the user's personal data",
    }),
  ];
}
