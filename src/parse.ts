/**
 * The Parse stage: turn a repo into an inspectable {@link Summary}.
 *
 * Detection is AST-based (via ts-morph) and deterministic — no LLM. It prefers
 * the curated SDK registry (see {@link ./registry}) over generic inference:
 * narrow-and-reliable over broad-and-wrong, because the one failure mode this
 * tool's audience can't catch is a false positive.
 *
 * The pure core is {@link summarizeFiles}, which takes an in-memory map of
 * `relativePath -> content` and returns a summary. {@link parseRepo} is the thin
 * disk edge: it walks a directory into that map and delegates. Keeping I/O at
 * the edge is what makes detection unit-testable against tiny snippets.
 */
import { readFile, readdir } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { Node, Project, SyntaxKind, ts } from "ts-morph";
import type { SourceFile } from "ts-morph";
import { assertDirectory } from "./paths.js";
import { lookupSdk } from "./registry.js";
import type {
  DetectedSecret,
  PiiSignal,
  PolicyPage,
  PolicyPages,
  Route,
  SchemaModel,
  SecretKind,
  Summary,
} from "./summary.js";

/** File extensions we hand to the TypeScript parser. */
const CODE_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
]);

/** Directories never worth walking. */
const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  "coverage",
  ".turbo",
]);

/** HTTP verbs that name a Next.js App Router handler export or an Express call. */
const HTTP_METHODS = new Set([
  "GET",
  "POST",
  "PUT",
  "DELETE",
  "PATCH",
  "HEAD",
  "OPTIONS",
]);
/** Express router method names (lowercase), including the catch-all `all`. */
const EXPRESS_METHODS = new Set([...HTTP_METHODS].map((m) => m.toLowerCase()).concat("all"));

/** Objects whose method calls we treat as logging. */
const LOG_ROOTS = new Set(["console", "logger", "log"]);
/** Method names that send an analytics event/trait. */
const ANALYTICS_METHODS = new Set(["track", "capture", "identify", "page", "group"]);
/** Methods that write a key into a URL/query (URLSearchParams-style). */
const URL_METHODS = new Set(["set", "append"]);

/**
 * Substrings (in a normalized, lowercased identifier) that mark a value as
 * personal data. Deliberately specific — bare "name" is excluded so that
 * `fileName`/`className` don't trip the PII detectors.
 */
const PII_SUBSTRINGS = [
  "email",
  "password",
  "passwd",
  "ssn",
  "socialsecurity",
  "creditcard",
  "cardnumber",
  "cardnum",
  "cvv",
  "phonenumber",
  "phone",
  "address",
  "dateofbirth",
  "birthdate",
  "firstname",
  "lastname",
  "fullname",
  "username",
  "passport",
  "driverslicense",
  "driverlicense",
  "ipaddress",
];

/**
 * High-confidence committed-secret token shapes. Each is a well-known credential
 * format distinctive enough that a match is a real leak, not a guess. `preview`
 * is how many leading characters of the match to keep in the redacted evidence.
 * Provider patterns are matched verbatim (no placeholder filtering) — a repo
 * carrying an `AKIA…`-shaped string is worth flagging regardless of its text.
 */
interface SecretPattern {
  kind: SecretKind;
  pattern: RegExp;
  preview: number;
}

const SECRET_PATTERNS: readonly SecretPattern[] = [
  { kind: "aws-access-key-id", pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/, preview: 4 },
  { kind: "stripe-secret-key", pattern: /\b(?:sk|rk)_live_[0-9A-Za-z]{16,}\b/, preview: 8 },
  { kind: "google-api-key", pattern: /\bAIza[0-9A-Za-z_-]{35}\b/, preview: 6 },
  { kind: "github-token", pattern: /\b(?:ghp|gho|ghu|ghs|ghr)_[0-9A-Za-z]{36}\b/, preview: 4 },
  {
    kind: "private-key",
    pattern: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/,
    preview: 40,
  },
];

/**
 * Identifier names that denote a credential, for the guarded generic fallback.
 * Matched case-insensitively against a variable or property name.
 */
const SECRET_NAME =
  /(?:api[_-]?key|secret|token|passwd|password|access[_-]?key|client[_-]?secret|auth[_-]?token)/i;

/**
 * Markers that disqualify a value from the generic rule: obvious placeholders,
 * template interpolation, and angle-bracket stand-ins. Keeps the generic path
 * from crying wolf on `"your-api-key-here"` or `` `${env.KEY}` ``.
 */
const SECRET_PLACEHOLDER =
  /(example|xxxx|your[_-]|placeholder|change[_-]?me|dummy|sample|redacted|\.\.\.|<[^>]+>|\$\{)/i;

/** Basename patterns for a standalone privacy / terms document. */
const POLICY_DOC_PATTERNS: Record<"privacy" | "terms", RegExp> = {
  privacy: /^privacy(-policy)?\.(mdx?|html?|txt)$/i,
  terms: /^terms(-of-service|-of-use|-and-conditions)?\.(mdx?|html?|txt)$/i,
};

/**
 * Summarize an in-memory set of files. This is the pure core of the Parse stage:
 * given `relativePath -> content`, it returns the {@link Summary} with no disk
 * access, so checks and tests can drive it with tiny snippets.
 */
export function summarizeFiles(
  files: Record<string, string>,
  repoPath = ".",
): Summary {
  const project = new Project({
    useInMemoryFileSystem: true,
    skipAddingFilesFromTsConfig: true,
    compilerOptions: { allowJs: true, jsx: ts.JsxEmit.Preserve },
  });

  const sourcesByRel = new Map<string, SourceFile>();
  for (const [rel, content] of Object.entries(files)) {
    if (isCodeFile(rel)) {
      sourcesByRel.set(rel, project.createSourceFile(`/${rel}`, content, { overwrite: true }));
    }
  }

  const routes = [
    ...deriveNextRoutes(files, sourcesByRel),
    ...detectExpressRoutes(sourcesByRel),
  ];

  return {
    repoPath,
    routes,
    schema: [...detectPrismaModels(files), ...detectMongooseModels(sourcesByRel)],
    sdks: detectSdks(sourcesByRel),
    policyPages: detectPolicyPages(files, sourcesByRel, routes),
    piiSignals: detectPiiSignals(sourcesByRel),
    secrets: detectSecrets(sourcesByRel),
  };
}

/**
 * Parse a repository on disk into a {@link Summary}. Walks the directory,
 * reading only files the Parse stage understands (code, `.prisma`, and policy
 * docs), then delegates to {@link summarizeFiles}. Source code is read locally
 * and never leaves the machine.
 */
export async function parseRepo(repoPath: string): Promise<Summary> {
  await assertDirectory(repoPath, "parse");
  const files: Record<string, string> = {};
  await collectFiles(repoPath, repoPath, files);
  return summarizeFiles(files, repoPath);
}

// --- SDK detection -----------------------------------------------------------

function detectSdks(sourcesByRel: Map<string, SourceFile>) {
  const sdks: Summary["sdks"] = [];

  for (const [rel, sf] of sourcesByRel) {
    // Collect each curated package imported in this file, with its local bindings.
    const perPackage = new Map<
      string,
      { entry: NonNullable<ReturnType<typeof lookupSdk>>; names: Set<string> }
    >();

    const note = (specifier: string, names: string[]) => {
      const entry = lookupSdk(specifier);
      if (!entry) return;
      const existing = perPackage.get(entry.package) ?? { entry, names: new Set<string>() };
      for (const name of names) existing.names.add(name);
      perPackage.set(entry.package, existing);
    };

    for (const imp of sf.getImportDeclarations()) {
      const names: string[] = [];
      const def = imp.getDefaultImport();
      if (def) names.push(def.getText());
      const ns = imp.getNamespaceImport();
      if (ns) names.push(ns.getText());
      for (const named of imp.getNamedImports()) {
        names.push((named.getAliasNode() ?? named.getNameNode()).getText());
      }
      note(imp.getModuleSpecifierValue(), names);
    }

    for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      const callee = call.getExpression();
      if (!Node.isIdentifier(callee) || callee.getText() !== "require") continue;
      const arg = call.getArguments()[0];
      if (!arg || !Node.isStringLiteral(arg)) continue;
      note(arg.getLiteralValue(), requireBindingNames(call));
    }

    for (const { entry, names } of perPackage.values()) {
      sdks.push({
        package: entry.package,
        dataCategory: entry.dataCategory,
        destination: entry.destination,
        whyItMatters: entry.whyItMatters,
        imported: true,
        called: [...names].some((name) => isNameCalled(sf, name)),
        file: rel,
      });
    }
  }

  return sdks;
}

/** Local binding names introduced by `const x = require(...)` (incl. destructuring). */
function requireBindingNames(call: Node): string[] {
  const decl = call.getFirstAncestorByKind(SyntaxKind.VariableDeclaration);
  if (!decl) return [];
  const nameNode = decl.getNameNode();
  if (Node.isIdentifier(nameNode)) return [nameNode.getText()];
  if (Node.isObjectBindingPattern(nameNode)) {
    return nameNode.getElements().map((el) => el.getName());
  }
  return [];
}

/** Whether any occurrence of `name` in `sf` is invoked (called or constructed). */
function isNameCalled(sf: SourceFile, name: string): boolean {
  return sf
    .getDescendantsOfKind(SyntaxKind.Identifier)
    .filter((id) => id.getText() === name)
    .some(isCalledUsage);
}

/** True when `id` is the thing being called: `id(...)`, `new id(...)`, `id.a.b(...)`. */
function isCalledUsage(id: Node): boolean {
  let node: Node = id;
  let parent = node.getParent();
  while (parent && Node.isPropertyAccessExpression(parent) && parent.getExpression() === node) {
    node = parent;
    parent = node.getParent();
  }
  return (
    !!parent &&
    (Node.isCallExpression(parent) || Node.isNewExpression(parent)) &&
    parent.getExpression() === node
  );
}

// --- Route detection ---------------------------------------------------------

function deriveNextRoutes(
  files: Record<string, string>,
  sourcesByRel: Map<string, SourceFile>,
): Route[] {
  const routes: Route[] = [];

  for (const rel of Object.keys(files)) {
    if (!isCodeFile(rel)) continue;
    const parts = rel.split("/");
    const fileName = parts[parts.length - 1] ?? "";
    const stem = stripExtension(fileName);

    const appIdx = parts.lastIndexOf("app");
    if (appIdx !== -1 && appIdx < parts.length - 1) {
      const between = parts.slice(appIdx + 1, parts.length - 1);
      if (stem === "route") {
        for (const method of exportedHttpMethods(sourcesByRel.get(rel))) {
          routes.push({ path: nextRoutePath(between), method, source: "next-app", file: rel });
        }
      } else if (stem === "page") {
        routes.push({ path: nextRoutePath(between), source: "next-app", file: rel });
      }
      continue;
    }

    const pagesIdx = parts.lastIndexOf("pages");
    if (pagesIdx !== -1 && pagesIdx < parts.length - 1) {
      if (stem.startsWith("_")) continue; // _app, _document, _error
      const between = parts.slice(pagesIdx + 1, parts.length - 1);
      const segments = stem === "index" ? between : [...between, stem];
      routes.push({ path: nextRoutePath(segments), source: "next-pages", file: rel });
    }
  }

  return routes;
}

/** Names of exported functions/consts in a route file that are HTTP verbs. */
function exportedHttpMethods(sf: SourceFile | undefined): string[] {
  if (!sf) return [];
  const methods = new Set<string>();
  for (const fn of sf.getFunctions()) {
    const name = fn.getName();
    if (name && fn.isExported() && HTTP_METHODS.has(name)) methods.add(name);
  }
  for (const decl of sf.getVariableDeclarations()) {
    const name = decl.getName();
    if (HTTP_METHODS.has(name) && decl.getVariableStatement()?.isExported()) {
      methods.add(name);
    }
  }
  return [...methods];
}

/** Turn Next.js path segments into a URL: strip route groups, map [param] -> :param. */
function nextRoutePath(segments: string[]): string {
  const cleaned = segments
    .filter((s) => !(s.startsWith("(") && s.endsWith(")"))) // (route groups)
    .filter((s) => !s.startsWith("@")) // @parallel slots
    .map((s) => {
      const match = s.match(/^\[\.{0,3}(.+)\]$/);
      return match ? `:${match[1]}` : s;
    });
  return `/${cleaned.join("/")}`.replace(/\/{2,}/g, "/");
}

function detectExpressRoutes(sourcesByRel: Map<string, SourceFile>): Route[] {
  const routes: Route[] = [];

  for (const [rel, sf] of sourcesByRel) {
    for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      const expr = call.getExpression();
      if (!Node.isPropertyAccessExpression(expr)) continue;
      const method = expr.getName().toLowerCase();
      if (!EXPRESS_METHODS.has(method)) continue;
      const arg = call.getArguments()[0];
      // A real route registration takes a string path starting with "/" — this
      // filters out lookalikes such as Map#get("key").
      if (!arg || !Node.isStringLiteral(arg)) continue;
      const path = arg.getLiteralValue();
      if (!path.startsWith("/")) continue;
      routes.push({ path, method: method.toUpperCase(), source: "express", file: rel });
    }
  }

  return routes;
}

// --- Schema detection --------------------------------------------------------

function detectPrismaModels(files: Record<string, string>): SchemaModel[] {
  const models: SchemaModel[] = [];

  for (const [rel, content] of Object.entries(files)) {
    if (!rel.endsWith(".prisma")) continue;
    const modelBlock = /model\s+(\w+)\s*\{([^}]*)\}/g;
    let match: RegExpExecArray | null;
    while ((match = modelBlock.exec(content)) !== null) {
      const name = match[1] ?? "";
      const fields = (match[2] ?? "")
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith("//") && !line.startsWith("@@"))
        .map((line) => line.split(/\s+/)[0] ?? "")
        .filter((field) => /^\w+$/.test(field));
      models.push({ name, fields, source: "prisma", file: rel });
    }
  }

  return models;
}

function detectMongooseModels(sourcesByRel: Map<string, SourceFile>): SchemaModel[] {
  const models: SchemaModel[] = [];

  for (const [rel, sf] of sourcesByRel) {
    for (const expr of sf.getDescendantsOfKind(SyntaxKind.NewExpression)) {
      const calleeText = expr.getExpression().getText();
      if (calleeText !== "Schema" && !calleeText.endsWith(".Schema")) continue;
      const arg = expr.getArguments()[0];
      if (!arg || !Node.isObjectLiteralExpression(arg)) continue;
      const fields = arg
        .getProperties()
        .map((prop) =>
          Node.isPropertyAssignment(prop) || Node.isShorthandPropertyAssignment(prop)
            ? prop.getName()
            : undefined,
        )
        .filter((name): name is string => name !== undefined);
      const name =
        expr.getFirstAncestorByKind(SyntaxKind.VariableDeclaration)?.getName() ?? "Schema";
      models.push({ name, fields, source: "mongoose", file: rel });
    }
  }

  return models;
}

// --- Policy pages ------------------------------------------------------------

function detectPolicyPages(
  files: Record<string, string>,
  sourcesByRel: Map<string, SourceFile>,
  routes: Route[],
): PolicyPages {
  return {
    privacy: findPolicyPage("privacy", files, sourcesByRel, routes),
    terms: findPolicyPage("terms", files, sourcesByRel, routes),
  };
}

function findPolicyPage(
  kind: "privacy" | "terms",
  files: Record<string, string>,
  sourcesByRel: Map<string, SourceFile>,
  routes: Route[],
): PolicyPage {
  const route = routes.find((r) => r.path === `/${kind}`);
  if (route) {
    const sf = sourcesByRel.get(route.file);
    return { present: true, file: route.file, text: sf ? extractSourceText(sf) : undefined };
  }

  const pattern = POLICY_DOC_PATTERNS[kind];
  for (const [rel, content] of Object.entries(files)) {
    const base = rel.split("/").pop() ?? "";
    if (pattern.test(base)) {
      return { present: true, file: rel, text: extractDocText(rel, content) };
    }
  }

  return { present: false };
}

/**
 * Human-readable text of a component: JSX text plus string/template literals.
 * Module specifiers are skipped so an `import ... from "stripe"` can't later be
 * mistaken by the drift check for the policy actually naming Stripe.
 */
function extractSourceText(sf: SourceFile): string {
  const parts: string[] = [];
  for (const s of sf.getDescendantsOfKind(SyntaxKind.StringLiteral)) {
    if (!isModuleSpecifier(s)) parts.push(s.getLiteralText());
  }
  for (const s of sf.getDescendantsOfKind(SyntaxKind.NoSubstitutionTemplateLiteral)) {
    parts.push(s.getLiteralText());
  }
  for (const s of sf.getDescendantsOfKind(SyntaxKind.JsxText)) {
    parts.push(s.getText());
  }
  return collapseWhitespace(parts.join(" "));
}

/** Whether a string literal is the module specifier of an import/export/require. */
function isModuleSpecifier(node: Node): boolean {
  const parent = node.getParent();
  if (!parent) return false;
  if (Node.isImportDeclaration(parent) || Node.isExportDeclaration(parent)) {
    return parent.getModuleSpecifier() === node;
  }
  return (
    Node.isCallExpression(parent) &&
    Node.isIdentifier(parent.getExpression()) &&
    parent.getExpression().getText() === "require" &&
    parent.getArguments()[0] === node
  );
}

/** Text of a standalone doc: raw for markdown/text, tag-stripped for HTML. */
function extractDocText(rel: string, content: string): string {
  const isHtml = /\.html?$/i.test(rel);
  return collapseWhitespace(isHtml ? content.replace(/<[^>]+>/g, " ") : content);
}

// --- PII-flow signals --------------------------------------------------------

function detectPiiSignals(sourcesByRel: Map<string, SourceFile>): PiiSignal[] {
  const signals: PiiSignal[] = [];

  for (const [rel, sf] of sourcesByRel) {
    for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      const expr = call.getExpression();
      if (!Node.isPropertyAccessExpression(expr)) continue;
      const method = expr.getName();
      const root = leftmostIdentifier(expr);
      const line = call.getStartLineNumber();
      const snippet = snippetOf(call);

      if (root && LOG_ROOTS.has(root)) {
        for (const field of piiFieldsIn(call)) {
          signals.push({ kind: "log", field, file: rel, line, snippet });
        }
      } else if (ANALYTICS_METHODS.has(method)) {
        for (const field of piiFieldsIn(call)) {
          signals.push({ kind: "analytics-event", field, file: rel, line, snippet });
        }
      }

      if (URL_METHODS.has(method)) {
        const arg = call.getArguments()[0];
        if (arg && Node.isStringLiteral(arg) && isPiiName(arg.getLiteralValue())) {
          signals.push({
            kind: "url",
            field: arg.getLiteralValue(),
            file: rel,
            line,
            snippet,
          });
        }
      }
    }

    // Personal data baked into a query string, e.g. `/track?email=${x}`.
    const stringNodes = [
      ...sf.getDescendantsOfKind(SyntaxKind.StringLiteral),
      ...sf.getDescendantsOfKind(SyntaxKind.NoSubstitutionTemplateLiteral),
      ...sf.getDescendantsOfKind(SyntaxKind.TemplateExpression),
    ];
    for (const node of stringNodes) {
      const queryKey = /[?&]([A-Za-z0-9_]+)=/g;
      let match: RegExpExecArray | null;
      while ((match = queryKey.exec(node.getText())) !== null) {
        const key = match[1] ?? "";
        if (isPiiName(key)) {
          signals.push({
            kind: "url",
            field: key,
            file: rel,
            line: node.getStartLineNumber(),
            snippet: snippetOf(node),
          });
        }
      }
    }
  }

  return dedupeSignals(signals);
}

/** Distinct personal-data field names referenced anywhere within `node`. */
function piiFieldsIn(node: Node): string[] {
  const fields = new Set<string>();
  for (const id of node.getDescendantsOfKind(SyntaxKind.Identifier)) {
    if (isPiiName(id.getText())) fields.add(id.getText());
  }
  for (const access of node.getDescendantsOfKind(SyntaxKind.PropertyAccessExpression)) {
    if (isPiiName(access.getName())) fields.add(access.getName());
  }
  return [...fields];
}

/**
 * Whether an identifier names personal data, by the same substring rule the PII
 * signal detectors use. Exported as the single source of truth so downstream
 * checks (e.g. the missing-path checks' "does this repo hold personal data?"
 * gate) grade against the exact set the parser recognises, without duplicating
 * the list.
 */
export function isPiiName(name: string): boolean {
  const normalized = name.toLowerCase().replace(/[^a-z0-9]/g, "");
  return PII_SUBSTRINGS.some((hint) => normalized.includes(hint));
}

/** The leftmost identifier of a (possibly nested) property-access chain. */
function leftmostIdentifier(expr: Node): string | undefined {
  let node: Node = expr;
  while (Node.isPropertyAccessExpression(node)) node = node.getExpression();
  return Node.isIdentifier(node) ? node.getText() : undefined;
}

function dedupeSignals(signals: PiiSignal[]): PiiSignal[] {
  const seen = new Set<string>();
  return signals.filter((s) => {
    const key = `${s.kind}|${s.field}|${s.file}|${s.line}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// --- Committed secrets -------------------------------------------------------

/**
 * Find hard-coded credentials committed in the source. Two passes, narrowest
 * first: high-confidence provider token shapes over every string/template
 * literal, then a guarded generic rule for secret-named assignments holding a
 * credential-shaped literal. At most one secret is reported per file:line, and
 * the provider pass wins ties, so the same value is never double-counted.
 */
function detectSecrets(sourcesByRel: Map<string, SourceFile>): DetectedSecret[] {
  const secrets: DetectedSecret[] = [];
  const seen = new Set<string>();

  const record = (kind: SecretKind, file: string, line: number, matched: string, preview: number) => {
    const key = `${file}:${line}`;
    if (seen.has(key)) return;
    seen.add(key);
    secrets.push({ kind, file, line, preview: redactSecret(matched, preview) });
  };

  for (const [rel, sf] of sourcesByRel) {
    for (const node of stringLiteralNodes(sf)) {
      const match = matchProviderSecret(node.getLiteralText());
      if (match) record(match.kind, rel, node.getStartLineNumber(), match.matched, match.preview);
    }

    for (const { name, value, node } of namedStringAssignments(sf)) {
      if (SECRET_NAME.test(name) && looksLikeCredential(value)) {
        record("generic-api-key", rel, node.getStartLineNumber(), value, 4);
      }
    }
  }

  return secrets;
}

/** The first provider pattern that matches `value`, with the exact matched token. */
function matchProviderSecret(
  value: string,
): { kind: SecretKind; matched: string; preview: number } | undefined {
  for (const { kind, pattern, preview } of SECRET_PATTERNS) {
    const found = value.match(pattern);
    if (found) return { kind, matched: found[0], preview };
  }
  return undefined;
}

/**
 * Whether a bare string value looks like a real credential rather than prose or
 * a placeholder: long, single-token, mixed letters-and-digits, and free of the
 * placeholder markers that mark an intentional stand-in.
 */
function looksLikeCredential(value: string): boolean {
  return (
    value.length >= 20 &&
    value.length <= 200 &&
    /^[A-Za-z0-9_\-+/=.~]+$/.test(value) &&
    /[A-Za-z]/.test(value) &&
    /[0-9]/.test(value) &&
    !SECRET_PLACEHOLDER.test(value)
  );
}

/** String and no-substitution template literals — the nodes that can hold a secret. */
function stringLiteralNodes(sf: SourceFile) {
  return [
    ...sf.getDescendantsOfKind(SyntaxKind.StringLiteral),
    ...sf.getDescendantsOfKind(SyntaxKind.NoSubstitutionTemplateLiteral),
  ];
}

/** Secret-named variable/property assignments to a plain string literal. */
function namedStringAssignments(
  sf: SourceFile,
): Array<{ name: string; value: string; node: Node }> {
  const out: Array<{ name: string; value: string; node: Node }> = [];

  const stringInitializer = (init: Node | undefined) =>
    init && (Node.isStringLiteral(init) || Node.isNoSubstitutionTemplateLiteral(init))
      ? init
      : undefined;

  for (const decl of sf.getVariableDeclarations()) {
    const nameNode = decl.getNameNode();
    const init = stringInitializer(decl.getInitializer());
    if (Node.isIdentifier(nameNode) && init) {
      out.push({ name: nameNode.getText(), value: init.getLiteralText(), node: init });
    }
  }

  for (const prop of sf.getDescendantsOfKind(SyntaxKind.PropertyAssignment)) {
    const init = stringInitializer(prop.getInitializer());
    if (init) out.push({ name: prop.getName(), value: init.getLiteralText(), node: init });
  }

  return out;
}

/** Keep the leading `keep` chars of a value; append an ellipsis when truncated. */
function redactSecret(value: string, keep: number): string {
  return value.length <= keep ? value : `${value.slice(0, keep)}…`;
}

// --- Shared helpers ----------------------------------------------------------

function isCodeFile(rel: string): boolean {
  const dot = rel.lastIndexOf(".");
  return dot !== -1 && CODE_EXTENSIONS.has(rel.slice(dot));
}

function stripExtension(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  return dot === -1 ? fileName : fileName.slice(0, dot);
}

function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function snippetOf(node: Node): string {
  return collapseWhitespace(node.getText()).slice(0, 120);
}

/** Whether a file is one the Parse stage reads: code, Prisma, or a policy doc. */
function isRelevantFile(rel: string): boolean {
  if (isCodeFile(rel) || rel.endsWith(".prisma")) return true;
  const base = rel.split("/").pop() ?? "";
  return POLICY_DOC_PATTERNS.privacy.test(base) || POLICY_DOC_PATTERNS.terms.test(base);
}

async function collectFiles(
  root: string,
  dir: string,
  out: Record<string, string>,
): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name) || entry.name.startsWith(".")) continue;
      await collectFiles(root, abs, out);
      continue;
    }
    if (!entry.isFile()) continue;
    const rel = relative(root, abs).split(sep).join("/");
    if (!isRelevantFile(rel)) continue;
    out[rel] = await readFile(abs, "utf8");
  }
}

