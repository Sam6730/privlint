import { describe, expect, it } from "vitest";
import { checkSellShareDisclosure, checkVendorDpas } from "./interview-facts.js";
import { emptySummary } from "./summary-fixture.js";
import { UNANSWERED_INTERVIEW } from "../types.js";
import type { InterviewAnswers } from "../types.js";

const answers = (o: Partial<InterviewAnswers>): InterviewAnswers => ({
  ...UNANSWERED_INTERVIEW,
  ...o,
});

const withVendor = emptySummary({
  sdks: [
    {
      package: "stripe",
      dataCategory: "payment",
      destination: "Stripe",
      whyItMatters: "card data leaves for a payment processor",
      imported: true,
      called: true,
      file: "app/api/charge/route.ts",
    },
  ],
});

describe("checkSellShareDisclosure", () => {
  it("fires a you-told-us CCPA finding when the founder says they sell/share", () => {
    const findings = checkSellShareDisclosure(
      emptySummary(),
      answers({ sellsOrSharesData: true }),
    );

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      id: "sell-share-ccpa",
      determination: "you-told-us",
    });
    // Conditional risk + a nudge to verify, never a legal verdict.
    expect(findings[0]?.fix.toLowerCase()).toContain("counsel");
  });

  it("stays silent when the answer is no or unknown", () => {
    expect(
      checkSellShareDisclosure(emptySummary(), answers({ sellsOrSharesData: false })),
    ).toEqual([]);
    expect(checkSellShareDisclosure(emptySummary(), UNANSWERED_INTERVIEW)).toEqual([]);
  });
});

describe("checkVendorDpas", () => {
  it("fires when there are vendors and the founder says no DPAs, naming the vendor", () => {
    const findings = checkVendorDpas(withVendor, answers({ hasSignedDpas: false }));

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      id: "missing-vendor-dpas",
      determination: "you-told-us",
      severity: "high",
    });
    expect(findings[0]?.consequence).toContain("Stripe");
  });

  it("softens severity to medium when the founder says there are no EU/UK users", () => {
    const findings = checkVendorDpas(
      withVendor,
      answers({ hasSignedDpas: false, hasEuUkUsers: false }),
    );
    expect(findings[0]?.severity).toBe("medium");
  });

  it("stays silent without vendors, or when DPAs are signed or unknown", () => {
    expect(checkVendorDpas(emptySummary(), answers({ hasSignedDpas: false }))).toEqual([]);
    expect(checkVendorDpas(withVendor, answers({ hasSignedDpas: true }))).toEqual([]);
    expect(checkVendorDpas(withVendor, UNANSWERED_INTERVIEW)).toEqual([]);
  });
});
