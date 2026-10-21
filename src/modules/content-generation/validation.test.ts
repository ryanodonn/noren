import { describe, it, expect } from "vitest";
import { validateGeneratedDialogue, DialogueValidationError } from "./validation";

function line(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    speaker: "a",
    ja: "こんにちは。",
    kana: "こんにちは。",
    romaji: "Konnichiwa.",
    en: "Hello.",
    gist: "greeting",
    tokens: [{ ja: "こんにちは。" }],
    ...overrides,
  };
}

function validDialogue() {
  return {
    setting: "A shop.",
    lines: [
      line({ speaker: "a" }),
      line({ speaker: "b" }),
      line({ speaker: "a" }),
      line({ speaker: "b" }),
      line({ speaker: "a" }),
      line({ speaker: "b" }),
    ],
  };
}

describe("validateGeneratedDialogue", () => {
  it("accepts a well-formed 6-line dialogue", () => {
    expect(() => validateGeneratedDialogue(validDialogue())).not.toThrow();
  });

  it("rejects fewer than 6 lines", () => {
    const dialogue = validDialogue();
    dialogue.lines = dialogue.lines.slice(0, 4);
    expect(() => validateGeneratedDialogue(dialogue)).toThrow(DialogueValidationError);
  });

  it("rejects more than 8 lines", () => {
    const dialogue = validDialogue();
    dialogue.lines = [...dialogue.lines, line({ speaker: "a" }), line({ speaker: "b" }), line({ speaker: "a" })];
    expect(() => validateGeneratedDialogue(dialogue)).toThrow(DialogueValidationError);
  });

  it("accepts a dialogue that opens on speaker b and alternates cleanly", () => {
    // `speaker` is a role binding, not a turn index — the customer opening
    // is a legitimate scene. Relabeling to force an "a" opener would
    // reassign every line to the wrong speaker; see validation.ts.
    const dialogue = validDialogue();
    dialogue.lines = ["b", "a", "b", "a", "b", "a"].map((speaker) => line({ speaker }));
    expect(() => validateGeneratedDialogue(dialogue)).not.toThrow();
  });

  it("rejects speakers that do not strictly alternate", () => {
    const dialogue = validDialogue();
    dialogue.lines = ["a", "a", "b", "b", "a", "b"].map((speaker) => line({ speaker }));
    expect(() => validateGeneratedDialogue(dialogue)).toThrow(DialogueValidationError);
  });

  it("rejects a dialogue where one speaker says everything", () => {
    const dialogue = validDialogue();
    dialogue.lines = ["a", "a", "a", "a", "a", "a"].map((speaker) => line({ speaker }));
    expect(() => validateGeneratedDialogue(dialogue)).toThrow(DialogueValidationError);
  });

  it("rejects an opener that is not a or b", () => {
    const dialogue = validDialogue();
    dialogue.lines[0] = line({ speaker: "clerk" });
    expect(() => validateGeneratedDialogue(dialogue)).toThrow(DialogueValidationError);
  });

  it("rejects a line missing a required field", () => {
    const dialogue = validDialogue();
    dialogue.lines[2] = line({ speaker: "a", gist: undefined });
    expect(() => validateGeneratedDialogue(dialogue)).toThrow(DialogueValidationError);
  });

  it("rejects tokens that don't reconstruct the ja text exactly", () => {
    const dialogue = validDialogue();
    dialogue.lines[1] = line({ speaker: "b", ja: "コーヒーをください。", tokens: [{ ja: "コーヒー" }] });
    expect(() => validateGeneratedDialogue(dialogue)).toThrow(DialogueValidationError);
  });

  it("reports every violation in the message, not just the first", () => {
    const dialogue = validDialogue();
    dialogue.lines = dialogue.lines.slice(0, 3);
    dialogue.lines[0] = line({ speaker: "b" });
    try {
      validateGeneratedDialogue(dialogue);
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(DialogueValidationError);
      const issues = (err as DialogueValidationError).issues;
      expect(issues.some((i) => i.includes("lines must be 6-8"))).toBe(true);
      expect(issues.some((i) => i.includes('expected speaker "a"'))).toBe(true);
    }
  });
});
