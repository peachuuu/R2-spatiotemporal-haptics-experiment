import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Questionnaire, validateResponses } from "../../src/components/Questionnaire";
import type { Question } from "../../src/protocol/questions.v1";

const discomfortQuestion: Question = {
  id: "comfort_discomfort",
  section: "condition",
  required: true,
  prompt: "How much discomfort did you experience?",
  response: { kind: "likert", min: 0, max: 10, anchors: { 0: "None", 10: "Worst" } }
};

describe("Questionnaire", () => {
  it("does not submit a required 0–10 item without a value", async () => {
    const onSubmit = vi.fn();
    render(<Questionnaire questions={[discomfortQuestion]} initialValues={{}} onValidSubmit={onSubmit} />);
    await userEvent.click(screen.getByRole("button", { name: /继续/ }));
    expect(screen.getByText(/请回答/)).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("submits a valid likert value", async () => {
    const onSubmit = vi.fn();
    render(<Questionnaire questions={[discomfortQuestion]} initialValues={{}} onValidSubmit={onSubmit} />);
    await userEvent.click(screen.getByLabelText("3"));
    await userEvent.click(screen.getByRole("button", { name: /继续/ }));
    expect(onSubmit).toHaveBeenCalledWith({ comfort_discomfort: 3 });
  });

  it("shows a character counter and enforces text limits", async () => {
    const onSubmit = vi.fn();
    const textQuestion: Question = {
      id: "comment",
      section: "final",
      required: true,
      prompt: "Any comments?",
      response: { kind: "text", minLength: 1, maxLength: 5 }
    };
    render(<Questionnaire questions={[textQuestion]} initialValues={{}} onValidSubmit={onSubmit} />);
    const input = screen.getByRole("textbox");
    await userEvent.type(input, "hello");
    expect(screen.getByText("5 / 5")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /继续/ }));
    expect(onSubmit).toHaveBeenCalledWith({ comment: "hello" });
  });

  it("rejects out-of-range values and wrong choices", async () => {
    const onSubmit = vi.fn();
    render(<Questionnaire questions={[discomfortQuestion]} initialValues={{ comfort_discomfort: 12 }} onValidSubmit={onSubmit} />);
    await userEvent.click(screen.getByRole("button", { name: /继续/ }));
    expect(screen.getByText(/0 到 10/)).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("submits choice and boolean answers", async () => {
    const onSubmit = vi.fn();
    const questions: Question[] = [
      {
        id: "pref",
        section: "final",
        required: true,
        prompt: "Which sample?",
        response: {
          kind: "choice",
          options: [
            { value: "a", label: "样本 A" },
            { value: "b", label: "Sample B" }
          ]
        }
      },
      { id: "flag", section: "final", required: true, prompt: "Agree?", response: { kind: "boolean" } }
    ];
    render(<Questionnaire questions={questions} initialValues={{}} onValidSubmit={onSubmit} />);
    await userEvent.click(screen.getByLabelText("样本 A"));
    await userEvent.click(screen.getByLabelText("Agree?"));
    await userEvent.click(screen.getByRole("button", { name: /继续/ }));
    expect(onSubmit).toHaveBeenCalledWith({ pref: "a", flag: true });
  });
});

describe("validateResponses", () => {
  it("reports each failed item and passes valid sets", () => {
    const failed = validateResponses([discomfortQuestion], { comfort_discomfort: 12 });
    expect(failed.valid).toBe(false);
    expect(failed.errors["comfort_discomfort"]).toBeTruthy();

    const missing = validateResponses([discomfortQuestion], {});
    expect(missing.valid).toBe(false);
    expect(missing.errors["comfort_discomfort"]).toMatch(/请回答/);

    expect(validateResponses([discomfortQuestion], { comfort_discomfort: 5 }).valid).toBe(true);
  });

  it("treats optional text items as valid when empty", () => {
    const optional: Question = {
      id: "reason",
      section: "comparison",
      required: false,
      prompt: "Why? (optional)",
      response: { kind: "text", minLength: 0, maxLength: 280 }
    };
    expect(validateResponses([optional], {}).valid).toBe(true);
    expect(validateResponses([optional], { reason: "x" }).valid).toBe(true);
  });
});
