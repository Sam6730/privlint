import { describe, expect, it } from "vitest";
import { classifyPiiField, SENSITIVITY_META } from "./pii-fields.js";

describe("classifyPiiField", () => {
  it("grades payment-card fields as `card`", () => {
    for (const field of ["cardNumber", "creditCard", "card_num", "cvv"]) {
      expect(classifyPiiField(field)).toBe("card");
    }
  });

  it("grades credentials and government IDs as `sensitive`", () => {
    for (const field of ["password", "passwd", "ssn", "socialSecurity", "passport", "driversLicense"]) {
      expect(classifyPiiField(field)).toBe("sensitive");
    }
  });

  it("grades ordinary personal data as `personal`", () => {
    for (const field of ["email", "phone", "homeAddress", "firstName"]) {
      expect(classifyPiiField(field)).toBe("personal");
    }
  });

  it("normalizes case and separators before matching", () => {
    // Same concept, three spellings — all fold to the same tier.
    expect(classifyPiiField("CARD-NUMBER")).toBe("card");
    expect(classifyPiiField("card_number")).toBe("card");
    expect(classifyPiiField("cardNumber")).toBe("card");
  });
});

describe("SENSITIVITY_META", () => {
  it("ranks card and sensitive data above ordinary personal data", () => {
    expect(SENSITIVITY_META.card.severity).toBe("high");
    expect(SENSITIVITY_META.sensitive.severity).toBe("high");
    expect(SENSITIVITY_META.personal.severity).toBe("medium");
  });

  it("gives each tier a distinct human-facing noun", () => {
    const nouns = [
      SENSITIVITY_META.card.noun,
      SENSITIVITY_META.sensitive.noun,
      SENSITIVITY_META.personal.noun,
    ];
    expect(new Set(nouns).size).toBe(3);
  });
});
