import { describe, expect, it } from "vitest";
import {
  collectInterview,
  interviewFromFile,
  interviewFromFlags,
  parseTriState,
} from "./interview.js";
import { UNANSWERED_INTERVIEW } from "./types.js";

describe("parseTriState", () => {
  it("reads yes/no/unknown and common variants", () => {
    expect(parseTriState("yes")).toBe(true);
    expect(parseTriState("Y")).toBe(true);
    expect(parseTriState("true")).toBe(true);
    expect(parseTriState("no")).toBe(false);
    expect(parseTriState("n")).toBe(false);
    expect(parseTriState("unknown")).toBe("unknown");
    expect(parseTriState("skip")).toBe("unknown");
  });

  it("returns undefined for unrecognised input", () => {
    expect(parseTriState("maybe")).toBeUndefined();
  });
});

describe("interviewFromFlags", () => {
  it("collects the three question flags", () => {
    expect(
      interviewFromFlags([
        "--eu-uk-users",
        "yes",
        "--signed-dpas",
        "no",
        "--sells-shares-data",
        "unknown",
      ]),
    ).toEqual({
      hasEuUkUsers: true,
      hasSignedDpas: false,
      sellsOrSharesData: "unknown",
    });
  });

  it("omits questions whose flag is absent", () => {
    expect(interviewFromFlags(["--eu-uk-users", "yes"])).toEqual({
      hasEuUkUsers: true,
    });
  });

  it("throws on an unrecognised flag value rather than guessing", () => {
    expect(() => interviewFromFlags(["--eu-uk-users", "perhaps"])).toThrow(
      /--eu-uk-users/,
    );
  });
});

describe("interviewFromFile", () => {
  it("reads booleans and unknown from JSON", () => {
    const json = JSON.stringify({
      hasEuUkUsers: true,
      hasSignedDpas: false,
      sellsOrSharesData: "unknown",
    });
    expect(interviewFromFile(json)).toEqual({
      hasEuUkUsers: true,
      hasSignedDpas: false,
      sellsOrSharesData: "unknown",
    });
  });

  it("accepts yes/no strings too", () => {
    expect(interviewFromFile(JSON.stringify({ hasEuUkUsers: "yes" }))).toEqual({
      hasEuUkUsers: true,
    });
  });

  it("ignores keys it doesn't recognise", () => {
    expect(interviewFromFile(JSON.stringify({ nope: 1 }))).toEqual({});
  });

  it("throws when the JSON isn't an object", () => {
    expect(() => interviewFromFile("[]")).toThrow();
  });
});

describe("collectInterview", () => {
  it("defaults every answer to unknown when nothing is supplied", async () => {
    expect(await collectInterview({ args: [] })).toEqual(UNANSWERED_INTERVIEW);
  });

  it("merges flags over the file over the unknown default", async () => {
    const fileContents = JSON.stringify({
      hasEuUkUsers: false,
      hasSignedDpas: false,
    });
    const answers = await collectInterview({
      args: ["--eu-uk-users", "yes"],
      fileContents,
    });
    expect(answers).toEqual({
      hasEuUkUsers: true, // flag wins over the file's false
      hasSignedDpas: false, // from the file
      sellsOrSharesData: "unknown", // neither supplied
    });
  });

  it("asks only the questions not already supplied non-interactively", async () => {
    const asked: string[] = [];
    const answers = await collectInterview({
      args: ["--eu-uk-users", "yes"],
      ask: async (question) => {
        asked.push(question.key);
        return "no";
      },
    });

    // The flag-supplied question is never asked; the other two are.
    expect(asked).toEqual(["hasSignedDpas", "sellsOrSharesData"]);
    expect(answers).toEqual({
      hasEuUkUsers: true,
      hasSignedDpas: false,
      sellsOrSharesData: false,
    });
  });

  it("treats an unrecognised interactive answer as unknown, never a crash", async () => {
    const answers = await collectInterview({
      args: [],
      ask: async () => "meh",
    });
    expect(answers).toEqual(UNANSWERED_INTERVIEW);
  });
});
