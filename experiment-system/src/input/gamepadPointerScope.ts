import type { StepId } from "../domain/types";

/** The game iframe exclusively owns controller input during formal game runs. */
export function pageGamepadPointerEnabled(stepId: StepId | undefined): boolean {
  return stepId !== "instruction" && stepId !== "condition-1" && stepId !== "condition-2";
}
