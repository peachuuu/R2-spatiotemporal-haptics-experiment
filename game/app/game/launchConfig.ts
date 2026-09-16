import type { AreaSequenceId, ConditionId, LaunchConfig, ProjectileSequenceId, RunMode } from "./types";

const conditions = new Set<ConditionId>(["NH", "BH", "STH"]);
const projectileSequences = new Set<ProjectileSequenceId>(["S1", "S2", "S3", "S4", "S5", "S6"]);
const areaSequences = new Set<AreaSequenceId>(["A1", "A2", "A3", "A4"]);
const required = (params: URLSearchParams, key: string) => { const value = params.get(key)?.trim(); if (!value) throw new Error(`${key} is required`); return value; };

/**
 * R2 launches practice in an iframe.  A browser opened directly on an
 * embedded-practice URL has no parent window to authenticate or notify, so it
 * intentionally becomes the ordinary local practice scene instead.
 */
export function normalizeTopLevelPracticeSearch(
  search: string,
  isTopLevel: boolean,
) {
  const params = new URLSearchParams(search);
  if (
    isTopLevel &&
    params.get("mode") === "practice" &&
    params.get("embedded") === "1"
  )
    return "?mode=practice";
  return search;
}

export function parseLaunchConfig(search = ""): LaunchConfig {
  const params = new URLSearchParams(search); const requestedMode = params.get("mode") ?? "practice";
  if (!["practice", "experiment", "developer"].includes(requestedMode)) throw new Error("mode is invalid");
  const mode = requestedMode as RunMode;
  if (mode === "practice") {
    const embedded = params.get("embedded") === "1";
    if (!embedded) return { mode, sessionId: "PRACTICE", runId: "PRACTICE-RUN", conditionId: "NH", projectileSequenceId: "S1", areaSequenceId: "A1", timelineSeed: "PRACTICE-TIMELINE", embedded: false };
    const parentOrigin = required(params, "parentOrigin");
    try {
      if (new URL(parentOrigin).origin !== parentOrigin) throw new Error();
    } catch {
      throw new Error("parentOrigin is invalid");
    }
    return { mode, sessionId: required(params, "sessionId"), runId: "PRACTICE-RUN", conditionId: "NH", projectileSequenceId: "S1", areaSequenceId: "A1", timelineSeed: "PRACTICE-TIMELINE", embedded: true, parentOrigin };
  }
  const conditionId = required(params, "condition") as ConditionId; const projectileSequenceId = required(params, "projectileSequence") as ProjectileSequenceId; const areaSequenceId = required(params, "areaSequence") as AreaSequenceId;
  if (!conditions.has(conditionId)) throw new Error("condition is invalid"); if (!projectileSequences.has(projectileSequenceId)) throw new Error("projectileSequence is invalid"); if (!areaSequences.has(areaSequenceId)) throw new Error("areaSequence is invalid");
  const config: LaunchConfig = { mode, sessionId: required(params, "sessionId"), runId: required(params, "runId"), conditionId, projectileSequenceId, areaSequenceId };
  if (mode === "experiment") {
    config.parentOrigin = required(params, "parentOrigin");
    // Both conditions of one session must share the same timeline seed so the
    // attack sequences stay identical; only the haptic policy may differ.
    config.timelineSeed = required(params, "timelineSeed");
    config.hapticGate = params.get("gate") !== "0";
  }
  return config;
}
