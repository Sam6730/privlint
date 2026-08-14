import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseRepo, summarizeFiles } from "./parse.js";

describe("summarizeFiles — SDK detection", () => {
  it("detects an imported and called Stripe SDK as payment/third-party", () => {
    const summary = summarizeFiles({
      "src/pay.ts": [
        `import Stripe from "stripe";`,
        `const stripe = new Stripe(process.env.STRIPE_KEY);`,
        `export const charge = () => stripe.charges.create({ amount: 100 });`,
      ].join("\n"),
    });

    expect(summary.sdks).toHaveLength(1);
    expect(summary.sdks[0]).toMatchObject({
      package: "stripe",
      dataCategory: "payment",
      destination: "Stripe",
      imported: true,
      called: true,
      file: "src/pay.ts",
    });
  });

  it("records an imported-but-unused SDK as called: false", () => {
    const summary = summarizeFiles({
      "src/unused.ts": `import Stripe from "stripe";`,
    });

    expect(summary.sdks[0]).toMatchObject({ imported: true, called: false });
  });

  it("detects a named analytics SDK import and its call", () => {
    const summary = summarizeFiles({
      "src/track.ts": [
        `import { PostHog } from "posthog-node";`,
        `const client = new PostHog("key");`,
        `client.capture({ distinctId: "1", event: "signup" });`,
      ].join("\n"),
    });

    expect(summary.sdks[0]).toMatchObject({
      destination: "PostHog",
      dataCategory: "analytics",
      called: true,
    });
  });

  it("detects SDKs imported via require()", () => {
    const summary = summarizeFiles({
      "src/ai.js": [
        `const OpenAI = require("openai");`,
        `const client = new OpenAI();`,
        `client.responses.create({ input: "hi" });`,
      ].join("\n"),
    });

    expect(summary.sdks[0]).toMatchObject({
      destination: "OpenAI",
      dataCategory: "llm",
      called: true,
    });
  });

  it("does not flag non-registry packages", () => {
    const summary = summarizeFiles({
      "src/util.ts": `import _ from "lodash"; _.chunk([1, 2, 3]);`,
    });
    expect(summary.sdks).toEqual([]);
  });
});

describe("summarizeFiles — route detection", () => {
  it("detects Next.js App Router API methods and page routes", () => {
    const summary = summarizeFiles({
      "app/api/users/route.ts": `export async function GET() {}\nexport async function POST() {}`,
      "app/privacy/page.tsx": `export default function Page() { return null; }`,
      "app/page.tsx": `export default function Home() { return null; }`,
      "app/blog/[slug]/page.tsx": `export default function Post() { return null; }`,
    });

    const routes = summary.routes.map((r) => ({ path: r.path, method: r.method }));
    expect(routes).toContainEqual({ path: "/api/users", method: "GET" });
    expect(routes).toContainEqual({ path: "/api/users", method: "POST" });
    expect(routes).toContainEqual({ path: "/privacy", method: undefined });
    expect(routes).toContainEqual({ path: "/", method: undefined });
    expect(routes).toContainEqual({ path: "/blog/:slug", method: undefined });
  });

  it("detects Next.js Pages Router routes and skips framework files", () => {
    const summary = summarizeFiles({
      "pages/api/hello.ts": `export default function handler(req, res) {}`,
      "pages/about.tsx": `export default function About() { return null; }`,
      "pages/index.tsx": `export default function Index() { return null; }`,
      "pages/_app.tsx": `export default function App() { return null; }`,
    });

    const paths = summary.routes.map((r) => r.path);
    expect(paths).toContain("/api/hello");
    expect(paths).toContain("/about");
    expect(paths).toContain("/");
    expect(paths).not.toContain("/_app");
  });

  it("detects Express routes with method and path", () => {
    const summary = summarizeFiles({
      "server.js": [
        `const app = express();`,
        `app.get("/users", (req, res) => {});`,
        `router.post("/login", handler);`,
        `const m = new Map(); m.get("notaroute");`,
      ].join("\n"),
    });

    const routes = summary.routes
      .filter((r) => r.source === "express")
      .map((r) => ({ path: r.path, method: r.method }));
    expect(routes).toContainEqual({ path: "/users", method: "GET" });
    expect(routes).toContainEqual({ path: "/login", method: "POST" });
    // Map#get with a non-path string must not be mistaken for a route.
    expect(routes).not.toContainEqual({ path: "notaroute", method: "GET" });
  });
});

describe("summarizeFiles — schema shape", () => {
  it("extracts Prisma model names and fields", () => {
    const summary = summarizeFiles({
      "prisma/schema.prisma": [
        `model User {`,
        `  id    String @id`,
        `  email String @unique`,
        `  name  String?`,
        `  @@index([email])`,
        `}`,
      ].join("\n"),
    });

    expect(summary.schema).toContainEqual(
      expect.objectContaining({
        name: "User",
        source: "prisma",
        fields: ["id", "email", "name"],
      }),
    );
  });

  it("extracts Mongoose schema fields", () => {
    const summary = summarizeFiles({
      "models/user.js": [
        `const userSchema = new mongoose.Schema({`,
        `  email: String,`,
        `  passwordHash: String,`,
        `});`,
      ].join("\n"),
    });

    const model = summary.schema.find((m) => m.source === "mongoose");
    expect(model?.fields).toEqual(["email", "passwordHash"]);
  });
});

describe("summarizeFiles — policy pages", () => {
  it("marks /privacy present and extracts its text from a Next page", () => {
    const summary = summarizeFiles({
      "app/privacy/page.tsx": `export default function P() { return <main>We use Stripe to process payments.</main>; }`,
    });

    expect(summary.policyPages.privacy.present).toBe(true);
    expect(summary.policyPages.privacy.text).toContain("Stripe");
    expect(summary.policyPages.terms.present).toBe(false);
  });

  it("excludes import specifiers from extracted policy text", () => {
    const summary = summarizeFiles({
      "app/privacy/page.tsx": [
        `import { track } from "posthog-js";`,
        `export default function P() { return <main>Our privacy commitment.</main>; }`,
      ].join("\n"),
    });

    // The prose is captured, but the "posthog-js" import path must not leak in —
    // otherwise the drift check would think the policy names PostHog.
    expect(summary.policyPages.privacy.text).toContain("Our privacy commitment.");
    expect(summary.policyPages.privacy.text).not.toContain("posthog");
  });

  it("detects a markdown terms file and reads its text", () => {
    const summary = summarizeFiles({
      "TERMS.md": `# Terms of Service\nYou agree to things.`,
    });

    expect(summary.policyPages.terms.present).toBe(true);
    expect(summary.policyPages.terms.text).toContain("agree");
  });
});

describe("summarizeFiles — PII signals", () => {
  it("flags personal data written to the console", () => {
    const summary = summarizeFiles({
      "src/log.ts": `function f(user) { console.log("got", user.email); }`,
    });

    const log = summary.piiSignals.find((s) => s.kind === "log");
    expect(log).toMatchObject({ kind: "log", field: "email", file: "src/log.ts" });
    expect(log?.line).toBe(1);
  });

  it("flags personal data placed in a query string", () => {
    const summary = summarizeFiles({
      "src/url.ts": "const u = `/track?email=${user.email}`;",
    });

    expect(summary.piiSignals.some((s) => s.kind === "url")).toBe(true);
  });

  it("flags personal data sent as an analytics event property", () => {
    const summary = summarizeFiles({
      "src/a.ts": `analytics.track("Signed Up", { email: user.email });`,
    });

    expect(summary.piiSignals.some((s) => s.kind === "analytics-event")).toBe(true);
  });

  it("stays silent on code with no personal-data flows", () => {
    const summary = summarizeFiles({
      "src/math.ts": `export const add = (a: number, b: number) => a + b;`,
    });

    expect(summary.piiSignals).toEqual([]);
  });
});

describe("parseRepo — reads from disk", () => {
  const minimalRepo = fileURLToPath(
    new URL("../test/fixtures/minimal", import.meta.url),
  );

  it("returns an empty-ish summary for a boring repo", async () => {
    const summary = await parseRepo(minimalRepo);
    expect(summary.repoPath).toBe(minimalRepo);
    expect(summary.sdks).toEqual([]);
    expect(summary.piiSignals).toEqual([]);
    expect(summary.policyPages.privacy.present).toBe(false);
  });

  it("rejects a path that is not a directory", async () => {
    await expect(parseRepo(minimalRepo + "/index.js")).rejects.toThrow();
  });
});
