import { describe, expect, it } from "vitest";
import { SDK_REGISTRY, lookupSdk } from "./registry.js";

describe("lookupSdk", () => {
  it("maps each seeded vendor to a data category and destination", () => {
    const byDestination = (name: string) =>
      SDK_REGISTRY.filter((e) => e.destination === name);

    // The five seeded vendors from the spec are all present.
    for (const name of ["Stripe", "Segment", "Mixpanel", "PostHog", "OpenAI"]) {
      expect(byDestination(name).length).toBeGreaterThan(0);
    }
  });

  it("tags Stripe as a payment processor", () => {
    const entry = lookupSdk("stripe");
    expect(entry).toMatchObject({
      dataCategory: "payment",
      destination: "Stripe",
    });
    expect(entry?.whyItMatters).toBeTruthy();
  });

  it("resolves subpath imports to their package root", () => {
    expect(lookupSdk("stripe/lib/resource")?.destination).toBe("Stripe");
  });

  it("resolves scoped package imports", () => {
    expect(lookupSdk("@segment/analytics-node")?.destination).toBe("Segment");
    expect(lookupSdk("@stripe/stripe-js")?.destination).toBe("Stripe");
  });

  it("returns undefined for unknown or local imports", () => {
    expect(lookupSdk("lodash")).toBeUndefined();
    expect(lookupSdk("./utils")).toBeUndefined();
    expect(lookupSdk("../db")).toBeUndefined();
    expect(lookupSdk("@scope")).toBeUndefined();
  });
});
