/**
 * The `summary.json` schema — the language-agnostic seam between the Parse stage
 * and everything downstream.
 *
 * {@link parseRepo} builds a {@link Summary} from a repo using AST parsing and a
 * curated SDK registry (see {@link ./registry}). Every check (deterministic and
 * judgment) consumes this summary, and the LLM reasons over it — never over raw
 * source. Keeping the schema small and inspectable is the point: a founder can
 * read it and trust what the tool detected.
 *
 * Adding a new language means writing an extractor that emits this same schema,
 * not touching any check. Detection is deterministic and prefers the curated
 * registry over generic inference: narrow-and-reliable over broad-and-wrong.
 */

/**
 * The kind of data a third-party vendor handles. A closed set (like
 * {@link RouteSource} and {@link SchemaSource}) so checks can switch on it and
 * the curated registry can't drift into ad-hoc labels.
 */
export type DataCategory = "payment" | "analytics" | "llm";

/** Which extractor/framework a detected route came from. */
export type RouteSource =
  | "next-app" // Next.js App Router (app/**/route.ts, app/**/page.tsx)
  | "next-pages" // Next.js Pages Router (pages/**, pages/api/**)
  | "express"; // Express/Connect (app.get("/x", ...))

/**
 * A reachable route/endpoint the app exposes. `method` is set for API-style
 * handlers (GET/POST/…) and left undefined for page routes that just render.
 */
export interface Route {
  /** URL path, normalized with a leading slash (e.g. "/api/users", "/privacy"). */
  path: string;
  /** HTTP method for API handlers; undefined for page routes. */
  method?: string;
  source: RouteSource;
  /** Repo-relative path to the file that defines the route. */
  file: string;
}

/** Where a model/schema definition was found. */
export type SchemaSource = "prisma" | "mongoose";

/**
 * A data model's shape — enough to see which personal-data fields the app
 * stores, not the full type. Field names are captured; types are not, because
 * PII detection keys off names.
 */
export interface SchemaModel {
  name: string;
  /** Field/column names declared on the model. */
  fields: string[];
  source: SchemaSource;
  /** Repo-relative path to the file that defines the model. */
  file: string;
}

/**
 * A third-party SDK the code actually pulls in, tagged from the curated
 * registry. The registry fields ({@link dataCategory}, {@link destination},
 * {@link whyItMatters}) explain the privacy relevance; the evidence fields
 * ({@link imported}, {@link called}) record how it was detected.
 */
export interface DetectedSdk {
  /** The registry package key that matched (e.g. "stripe"). */
  package: string;
  /** What kind of data this vendor handles (e.g. "payment", "analytics"). */
  dataCategory: DataCategory;
  /** Human-facing vendor name the data goes to (e.g. "Stripe"). */
  destination: string;
  /** Why a founder should care that this data leaves for this vendor. */
  whyItMatters: string;
  /** An import/require of the package was found. */
  imported: boolean;
  /** The imported binding is invoked (called or constructed) somewhere. */
  called: boolean;
  /** Repo-relative path where the import was found. */
  file: string;
}

/** Presence and extracted text of a single policy page. */
export interface PolicyPage {
  present: boolean;
  /** Repo-relative path to the page, when present. */
  file?: string;
  /**
   * Human-readable text extracted from the page (JSX text + string literals for
   * a component, raw text for markdown/HTML). Used by the drift check to see
   * which processors the policy names. Undefined when the page is absent.
   */
  text?: string;
}

/** Presence + text of the `/privacy` and `/terms` pages. */
export interface PolicyPages {
  privacy: PolicyPage;
  terms: PolicyPage;
}

/** Where personal data was seen flowing. */
export type PiiSignalKind =
  | "log" // written to a logger (console.*)
  | "url" // placed into a URL / query string
  | "analytics-event"; // sent as an analytics event property/trait

/**
 * A raw signal that a personal-data-shaped value flows somewhere risky. These
 * are evidence, not verdicts: downstream checks decide severity and phrasing.
 */
export interface PiiSignal {
  kind: PiiSignalKind;
  /** The personal-data-shaped identifier that triggered the signal (e.g. "email"). */
  field: string;
  /** Repo-relative path to the file. */
  file: string;
  /** 1-based line number of the flow. */
  line: number;
  /** The source snippet, trimmed, for the user to eyeball. */
  snippet: string;
}

/**
 * The kind of credential a committed-secret match represents. A closed set so
 * the secrets check can switch on it for severity and phrasing. Provider kinds
 * come from high-confidence token shapes; `generic-api-key` is the guarded
 * fallback for a secret-named assignment holding a credential-shaped literal.
 */
export type SecretKind =
  | "aws-access-key-id"
  | "stripe-secret-key"
  | "google-api-key"
  | "github-token"
  | "private-key"
  | "generic-api-key";

/**
 * A hard-coded credential found committed in the source. Detection is
 * deliberately narrow — high-confidence token shapes plus a guarded generic
 * rule — because a false positive here (crying wolf on a placeholder) is the one
 * failure mode this tool's audience can't catch. The full secret value is never
 * stored: only a redacted {@link preview} and its location, enough to find and
 * rotate it.
 */
export interface DetectedSecret {
  kind: SecretKind;
  /** Repo-relative path to the file the secret was committed in. */
  file: string;
  /** 1-based line number of the literal that held it. */
  line: number;
  /** Redacted preview (leading chars + "…"); never the full value. */
  preview: string;
}

/**
 * The inspectable summary of what a repo collects and where it goes. This is
 * the whole product of the Parse stage.
 */
export interface Summary {
  /** The repo path that was parsed. */
  repoPath: string;
  routes: Route[];
  schema: SchemaModel[];
  sdks: DetectedSdk[];
  policyPages: PolicyPages;
  piiSignals: PiiSignal[];
  /** Hard-coded credentials found committed in the source. */
  secrets: DetectedSecret[];
}
