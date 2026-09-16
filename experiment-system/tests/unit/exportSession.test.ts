import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import * as XLSX from "xlsx";
import { createStudySession } from "../../src/domain/session";
import type { AuditEvent, GameEventRecord, StudySession } from "../../src/domain/types";
import type { ObjectiveTrialRecord } from "../../src/domain/objective";
import {
  buildSessionZip,
  csvEscape,
  exportFileName,
  exportFileNameSuffix,
  exportSessionCsv,
  exportSessionJson,
  exportSessionZipName,
  GAME_EVENT_COLUMNS,
  HXI_COLUMNS,
  PXI_COLUMNS,
  SUBJECTIVE_COLUMNS,
  toAuditCsv,
  toGameEventsCsv,
  toGameSummaryCsv,
  toHapticCuesCsv,
  toHxiCsv,
  toHxiKeyCsv,
  toPxiCsv,
  toPxiKeyCsv,
  toSubjectiveCsv,
  toObjectiveSummaryCsv
} from "../../src/storage/exportSession";

const NOW = "2026-08-23T00:00:00.000Z";

function sessionWithAnswer(questionId: string, value: number | string | boolean | string[]): StudySession {
  const session = createStudySession(
    {
      participantCode: "P001",
      studyMode: "dry-run",
      allocation: {
        counterbalanceCell: "AB",
        metadata: { methodVersion: "balanced-block-v1", blockId: 1, position: 0 }
      },
      gameAssignment: { timelineSeed: "SEED-T", projectileSequenceId: "S1", areaSequenceId: "A1" },
      profile: { nickname: "nick1", age: 22, gender: "male", hapticExperience: "never" }
    },
    NOW
  );
  return {
    ...session,
    id: "session-1",
    updatedAt: NOW,
    conditionResponses: { baseline: { [questionId]: value } }
  };
}

function sessionWithRuns(): StudySession {
  const base = sessionWithAnswer("comfort_discomfort", 3);
  const event: GameEventRecord = {
    sessionId: "session-1",
    runId: "session-1-C1",
    conditionId: "BH",
    projectileSequenceId: "S1",
    areaSequenceId: "A1",
    eventId: "projectile-evaded",
    outcome: "passed",
    atMs: 1200,
    phase: "combat",
    trialIndex: 2,
    reactionTimeMs: 480
  };
  return {
    ...base,
    conditionRuns: {
      baseline: {
        displayCondition: "A",
        conditionId: "baseline",
        startedAt: NOW,
        endedAt: NOW,
        events: [],
        status: "won",
        timelineSeed: "SEED-T",
        projectileSequenceId: "S1",
        areaSequenceId: "A1",
        attempts: [
          {
            attemptId: "attempt-1",
            runId: "session-1-C1",
            status: "running",
            startedAt: NOW,
            timelineSeed: "SEED-T",
            projectileSequenceId: "S1",
            areaSequenceId: "A1",
            gameEvents: [event],
            realizedStageOrder: [],
            timelineEvents: [],
            inputMethods: [],
            hapticCues: [],
            diagnostic: "stale running attempt interrupted on recovery or restart"
          },
          {
            attemptId: "attempt-2",
            runId: "session-1-C1",
            status: "won",
            startedAt: NOW,
            endedAt: NOW,
            elapsedMs: 96000,
            timelineSeed: "SEED-T",
            projectileSequenceId: "S1",
            areaSequenceId: "A1",
            gameEvents: [event],
            realizedStageOrder: ["G01", "G02"],
            timelineEvents: [{ timelineEventId: "G01", timelineOrder: 0, outcome: "completed", atMs: 5000 }],
            inputMethods: ["keyboard"],
            hapticCues: [],
            summary: { totalEvents: 1, projectileHits: 0, projectileEvades: 1, areaHits: 0, areaEscapes: 0, meanAvailableReactionTimeMs: 480, chestTrialsCompleted: 4, meanChestSearchTimeMs: 2100 }
          }
        ]
      }
    }
  };
}

function completeFormalSession(): StudySession {
  const base = sessionWithAnswer("comfort_electro", 6);
  const makeTrials = (stage: "A" | "B", visualAvailability: "limited" | "full", prefix: string): ObjectiveTrialRecord[] => {
    const rows: ObjectiveTrialRecord[] = [];
    for (const [trialType, total] of [["projectile", 16], ["area", 8], ["chest", 4]] as const) {
      for (let index = 1; index <= total; index++) rows.push({
        schemaVersion: "objective-trials.v1", trialUid: `${prefix}:${trialType}:${index}`, trialType, trialIndex: index,
        timelineEventId: trialType === "chest" ? ["G05", `${stage === "A" ? "G07" : "G11"}-CHEST01`, `${stage === "A" ? "G07" : "G11"}-CHEST02`, `${stage === "A" ? "G07" : "G11"}-CHEST03`][index - 1]! : `${prefix}:${trialType}:${index}`,
        stage, visualAvailability, startedAtMs: 1000, endedAtMs: 9000, trialValid: true, invalidReason: null,
        success: trialType === "projectile" && index === 16 ? 0 : 1, parameters: {},
        metrics: trialType === "chest" ? { audioOnsetMs: 2000, interactionTimeMs: 2000 + index * 1000, completionTimeMs: index * 1000 } : {}
      });
    }
    return rows;
  };
  const attempt = (game: "BH" | "STH", id: string) => ({
    attemptId: id, runId: id, status: "won" as const, startedAt: NOW, endedAt: NOW, timelineSeed: "SEED-T",
    projectileSequenceId: "S1" as const, areaSequenceId: "A1" as const,
    gameEvents: [{ sessionId: base.id, runId: id, conditionId: game, projectileSequenceId: "S1" as const, areaSequenceId: "A1" as const, eventId: "run", outcome: "won", atMs: 0, phase: "complete" }],
    realizedStageOrder: [], timelineEvents: [], inputMethods: ["keyboard"], hapticCues: [],
    objectiveTrials: [...makeTrials("A", "limited", `${id}:A`), ...makeTrials("B", "full", `${id}:B`)]
  });
  return {
    ...base,
    conditionRuns: {
      baseline: { displayCondition: "A", conditionId: "baseline", status: "won", startedAt: NOW, endedAt: NOW, timelineSeed: "SEED-T", projectileSequenceId: "S1", areaSequenceId: "A1", events: [], attempts: [attempt("BH", "bh-attempt")] },
      spatiotemporal: { displayCondition: "B", conditionId: "spatiotemporal", status: "won", startedAt: NOW, endedAt: NOW, timelineSeed: "SEED-T", projectileSequenceId: "S1", areaSequenceId: "A1", events: [], attempts: [attempt("STH", "sth-attempt")] }
    },
    conditionResponses: { baseline: { hxi_a1: 5, pxi_im1: 2, comfort_electro: 6, pain_electro: 1 }, spatiotemporal: { hxi_a1: 6, pxi_im1: 3, comfort_electro: 5, pain_electro: 2 } },
    comparisonResponses: Object.fromEntries(Array.from({ length: 9 }, (_, index) => {
      const eventId = `event-${String(index + 1).padStart(2, "0")}`;
      return [eventId, { eventId, baseSampleId: "sth.g02.rubble", order: { a: "sth" as const, b: "bh" as const }, ratings: { "sth.g02.rubble": 5, "bh.g02.rubble": 3 }, preference: "sth.g02.rubble", reason: "更自然" }];
    })),
    finalResponses: { final_preference: "a", final_difference: 6, final_reason: "整体更好" },
    interviewResponses: { interview_mismatch: "无", interview_other: "结束" }
  };
}

describe("toSubjectiveCsv", () => {
  it("exports one CSV row per questionnaire answer with condition context", () => {
    const csv = toSubjectiveCsv(sessionWithAnswer("comfort_discomfort", 3));
    // The display label comes from the condition run record; without a run
    // both display and game-condition cells stay empty.
    expect(csv.split("\n")).toContain(
      "session-1,P001,baseline,,,condition-assessment,comfort_discomfort,3,2026-08-23T00:00:00.000Z"
    );
    const withRun = toSubjectiveCsv(sessionWithRuns());
    expect(withRun.split("\n")).toContain(
      "session-1,P001,baseline,A,BH,condition-assessment,comfort_discomfort,3,2026-08-23T00:00:00.000Z"
    );
  });

  it("starts with the documented header and covers every response scope", () => {
    const session = sessionWithAnswer("comfort_discomfort", 3);
    const full: StudySession = {
      ...session,
      instructionResponses: { instr_how_many: "two" },
      comparisonResponses: {
        "event-01": {
          eventId: "event-01",
          baseSampleId: "sth.g02.rubble",
          order: { a: "sth", b: "bh" },
          ratings: { "sth.g02.rubble": 5, "bh.g02.rubble": 3 },
          preference: "sth.g02.rubble"
        }
      },
      finalResponses: { final_difference: 4 },
      interviewResponses: { interview_mismatch: "无" }
    };
    const lines = toSubjectiveCsv(full).trimEnd().split("\n");
    expect(lines[0]).toBe(SUBJECTIVE_COLUMNS.join(","));
    expect(lines).toContain("session-1,P001,,,,basic-info,nickname,nick1,2026-08-23T00:00:00.000Z");
    expect(lines).toContain("session-1,P001,,,,basic-info,age,22,2026-08-23T00:00:00.000Z");
    expect(lines).toContain("session-1,P001,,,,basic-info,gender,male,2026-08-23T00:00:00.000Z");
    expect(lines).toContain("session-1,P001,,,,basic-info,haptic_experience,never,2026-08-23T00:00:00.000Z");
    expect(lines).toContain("session-1,P001,,,,instruction,instr_how_many,two,2026-08-23T00:00:00.000Z");
    // 样本对比按解析后样本 ID（条件键）存储：STH 5 分、BH 3 分、选择 STH，并记录盲态映射。
    expect(lines).toContain("session-1,P001,,,,comparison,sth.g02.rubble,5,2026-08-23T00:00:00.000Z");
    expect(lines).toContain("session-1,P001,,,,comparison,bh.g02.rubble,3,2026-08-23T00:00:00.000Z");
    expect(lines).toContain("session-1,P001,,,,comparison,event-01-preference,sth.g02.rubble,2026-08-23T00:00:00.000Z");
    expect(lines).toContain("session-1,P001,,,,comparison,event-01-a-sample,sth,2026-08-23T00:00:00.000Z");
    expect(lines).toContain("session-1,P001,,,,comparison,event-01-b-sample,bh,2026-08-23T00:00:00.000Z");
    expect(lines).toContain("session-1,P001,,,,final,final_difference,4,2026-08-23T00:00:00.000Z");
    expect(lines).toContain("session-1,P001,,,,interview,interview_mismatch,无,2026-08-23T00:00:00.000Z");
    expect(lines).toHaveLength(15);
  });

  it("quotes values containing commas, quotes, and newlines", () => {
    expect(csvEscape("plain")).toBe("plain");
    expect(csvEscape("a,b")).toBe('"a,b"');
    expect(csvEscape('say "hi"')).toBe('"say ""hi"""');
    expect(csvEscape("line\nbreak")).toBe('"line\nbreak"');
  });

  it("serialises array answers with semicolons", () => {
    const csv = toSubjectiveCsv(sessionWithAnswer("multi", ["a", "b"]));
    expect(csv.split("\n")).toContain("session-1,P001,baseline,,,condition-assessment,multi,a;b,2026-08-23T00:00:00.000Z");
  });
});

describe("toHxiCsv", () => {
  function sessionWithHxiAnswers(): StudySession {
    return {
      ...sessionWithRuns(),
      conditionResponses: {
        baseline: {
          hxi_a1: 6,
          hxi_a2: 5,
          hxi_d1: 2,
          hxi_d3: 2,
          hxi_h4: 6,
          comfort_electro: 4,
          pain_electro: 2
        }
      }
    };
  }

  it("exports one wide row per condition with factor columns and trailing electro items", () => {
    const csv = toHxiCsv(sessionWithHxiAnswers());
    const lines = csv.trimEnd().split("\n");
    expect(lines[0]).toBe(HXI_COLUMNS.join(","));
    // 仅 baseline 有作答，spatiotemporal 无作答 → 只有一行。
    expect(lines).toHaveLength(2);
    const cells = lines[1]!.split(",");
    expect(cells).toHaveLength(HXI_COLUMNS.length);
    expect(cells[0]).toBe("session-1");
    expect(cells[1]).toBe("P001");
    expect(cells[2]).toBe("A"); // display condition
    expect(cells[3]).toBe("baseline");
    expect(cells[4]).toBe("BH"); // game condition id
    expect(cells[HXI_COLUMNS.indexOf("HXI_AU1")]).toBe("6");
    expect(cells[HXI_COLUMNS.indexOf("HXI_AU2")]).toBe("5");
    expect(cells[HXI_COLUMNS.indexOf("HXI_HA4")]).toBe("6");
    expect(cells[HXI_COLUMNS.indexOf("comfort_electro")]).toBe("4");
    expect(cells[HXI_COLUMNS.indexOf("pain_electro")]).toBe("2");
  });

  it("keeps raw 1–7 scores and never reverse-scores Discord", () => {
    const csv = toHxiCsv(sessionWithHxiAnswers());
    const cells = csv.trimEnd().split("\n")[1]!.split(",");
    // hxi_d1 / hxi_d3 原始分 2 原样保存，不做 8−x 转换。
    expect(cells[HXI_COLUMNS.indexOf("HXI_DI1")]).toBe("2");
    expect(cells[HXI_COLUMNS.indexOf("HXI_DI3")]).toBe("2");
  });

  it("leaves unanswered factor cells blank", () => {
    const csv = toHxiCsv(sessionWithHxiAnswers());
    const cells = csv.trimEnd().split("\n")[1]!.split(",");
    expect(cells[HXI_COLUMNS.indexOf("HXI_IN1")]).toBe("");
  });
});

describe("toHxiKeyCsv", () => {
  it("lists every factor column with dimension, official item text and raw scoring", () => {
    const csv = toHxiKeyCsv();
    const lines = csv.trimEnd().split("\n");
    expect(lines[0]).toBe(
      "column,factor,factor_name,item,direction,question_id,item_text,item_text_en,scoring"
    );
    expect(lines).toHaveLength(23); // 表头 + 20 HXI + 2 电刺激题
    // 英文原文含逗号时按 CSV 规则加引号。
    expect(lines).toContain(
      "HXI_AU1,AU,自目的愉悦性 Autotelics,1,positive,hxi_a1,不考虑其功能，我觉得这些触觉感受是令人愉悦的。,\"Regardless of function, I found the haptic sensations pleasant.\",1–7 原始分"
    );
    expect(lines).toContain(
      "HXI_DI1,DI,失调感 Discord,1,negative,hxi_d1,这些触觉感受似乎与其他感官之间缺乏协调。,The haptic sensations seemed to lack coordination with other senses.,1–7 原始分（负向维度；分析阶段如需因子分请用 8−x 反向计分，导出不做转换）"
    );
    expect(lines.at(-1)).toContain("pain_electro");
    expect(lines.at(-2)).toContain("comfort_electro");
  });
});

describe("toPxiCsv", () => {
  function sessionWithPxiAnswers(): StudySession {
    return {
      ...sessionWithRuns(),
      conditionResponses: {
        baseline: {
          pxi_im1: -3,
          pxi_im2: 0,
          pxi_ma3: 3
        }
      }
    };
  }

  it("exports one wide row per condition with factor columns", () => {
    const csv = toPxiCsv(sessionWithPxiAnswers());
    const lines = csv.trimEnd().split("\n");
    expect(lines[0]).toBe(PXI_COLUMNS.join(","));
    expect(lines).toHaveLength(2);
    const cells = lines[1]!.split(",");
    expect(cells).toHaveLength(PXI_COLUMNS.length);
    expect(cells[0]).toBe("session-1");
    expect(cells[1]).toBe("P001");
    expect(cells[2]).toBe("A");
    expect(cells[3]).toBe("baseline");
    expect(cells[4]).toBe("BH");
    expect(cells[PXI_COLUMNS.indexOf("PXI_IM1")]).toBe("-3");
    expect(cells[PXI_COLUMNS.indexOf("PXI_IM2")]).toBe("0");
    expect(cells[PXI_COLUMNS.indexOf("PXI_MA3")]).toBe("3");
  });

  it("keeps raw -3 to +3 scores and leaves unanswered cells blank", () => {
    const csv = toPxiCsv(sessionWithPxiAnswers());
    const cells = csv.trimEnd().split("\n")[1]!.split(",");
    expect(cells[PXI_COLUMNS.indexOf("PXI_MA1")]).toBe("");
  });
});

describe("toPxiKeyCsv", () => {
  it("lists every PXI factor column with dimension, official item text and raw scoring", () => {
    const csv = toPxiKeyCsv();
    const lines = csv.trimEnd().split("\n");
    expect(lines[0]).toBe(
      "column,factor,factor_name,item,direction,question_id,item_text,item_text_en,scoring"
    );
    expect(lines).toHaveLength(7); // 表头 + 6 PXI 题
    expect(lines).toContain(
      "PXI_IM1,IM,沉浸感 Immersion,1,positive,pxi_im1,在游戏过程中，我几乎没有再注意到周围的环境。,I was no longer aware of my surroundings while I was playing.,-3–3 原始分"
    );
    expect(lines).toContain(
      "PXI_MA3,MA,掌控感 Mastery,3,positive,pxi_ma3,在玩这个游戏时，我感到自己能够很好地掌握它。,I felt a sense of mastery playing this game.,-3–3 原始分"
    );
  });
});

describe("objective CSVs", () => {
  it("exports one game-events row per event with attempt identity", () => {
    const csv = toGameEventsCsv(sessionWithRuns());
    expect(csv.split("\n")[0]).toBe(GAME_EVENT_COLUMNS.join(","));
    expect(csv.split("\n").filter(line => line.includes("attempt-1")).at(0)).toContain(
      "session-1,P001,baseline,A,BH,session-1-C1,attempt-1,,projectile-evaded,passed,1200,combat,2,,480"
    );
    expect(csv.split("\n").filter(line => line.includes("attempt-2")).at(0)).toContain(
      "session-1,P001,baseline,A,BH,session-1-C1,attempt-2,,projectile-evaded,passed,1200,combat,2,,480"
    );
  });

  it("exports one game-summary row per attempt with seed, sequences and metrics", () => {
    const csv = toGameSummaryCsv(sessionWithRuns());
    const lines = csv.trimEnd().split("\n");
    expect(lines).toHaveLength(3);
    // Attempts keep their history order: interrupted first, winning last.
    expect(lines[1]).toContain("session-1,P001,baseline,A,BH,session-1-C1,attempt-1,running");
    expect(lines[1]).toContain("SEED-T,S1,A1");
    expect(lines[1]).toContain("stale running attempt interrupted");
    expect(lines[2]).toContain("session-1,P001,baseline,A,BH,session-1-C1,attempt-2,won");
    expect(lines[2]).toContain('"[""G01"",""G02""]"');
    expect(lines[0]).toContain("chest_trials_completed,mean_chest_search_time_ms");
    expect(lines[2]).toContain("1,0,1,0,0,480,4,2100");
  });

  it("exports the audit log with JSON detail cells", () => {
    const csv = toAuditCsv(sessionWithRuns());
    expect(csv.split("\n")[0]).toBe("session_id,participant_code,at,type,step_id,detail");
    expect(csv.split("\n")[1]).toContain("session-1,P001,2026-08-23T00:00:00.000Z,SessionStarted,,");
    expect(csv.split("\n")[1]).toContain('"participantCode"');
  });
});

describe("toHapticCuesCsv", () => {
  it("exports one row per cue with full synchronization timestamps", () => {
    const session = sessionWithRuns();
    const withCue: StudySession = {
      ...session,
      conditionRuns: {
        ...session.conditionRuns,
        baseline: {
          ...session.conditionRuns.baseline!,
          attempts: [
            ...session.conditionRuns.baseline!.attempts.slice(0, -1),
            {
              ...session.conditionRuns.baseline!.attempts.at(-1)!,
              hapticCues: [
                {
                  cueKey: "projectile",
                  baseSampleId: "07Alf",
                  resolvedSampleId: "B07Alf",
                  requestedAtMs: 1000,
                  prepareSentAtMs: 1001,
                  preparedAtMs: 1020,
                  commitSentAtMs: 1021,
                  mediaScheduledAtMs: 1170,
                  deviceStartedAtMs: 1172,
                  deviceStartUs: 98765,
                  leadMs: 150,
                  estimatedSkewMs: 2,
                  outcome: "ok",
                  at: NOW
                }
              ]
            }
          ]
        }
      }
    };
    const csv = toHapticCuesCsv(withCue);
    expect(csv.split("\n")[0]).toBe(
      "session_id,participant_code,condition_id,display_condition,run_id,attempt_id,trial_uid,cue_key,base_sample_id,resolved_sample_id,requested_at_ms,prepare_sent_at_ms,prepared_at_ms,commit_sent_at_ms,media_scheduled_at_ms,device_started_at_ms,device_start_us,lead_ms,estimated_skew_ms,outcome,error_detail,at"
    );
    expect(csv.split("\n")[1]).toContain("session-1,P001,baseline,A,session-1-C1,attempt-2,,projectile,07Alf,B07Alf,1000,1001,1020,1021,1170,1172,98765,150,2,ok,,");
  });
});

describe("exportFileName", () => {
  const fixedNow = new Date(2026, 7, 28, 10, 0, 0); // 本地 2026-08-28 → 20260828

  it("sanitises unrestricted participant codes in exported filenames", () => {
    const session = sessionWithAnswer("comfort_discomfort", 3);
    expect(exportFileName(session, "csv", fixedNow)).toBe("P001-subjective-20260828.csv");
    const weird = { ...session, participantCode: " P/001 测试:组 " };
    expect(exportFileName(weird, "json", fixedNow)).toBe("P-001-测试-组-session-20260828.json");
    const blank = { ...session, participantCode: "  " };
    expect(exportFileName(blank, "json", fixedNow)).toBe("participant-session-20260828.json");
  });

  it("zero-pads the local date stamp and uses the content suffix", () => {
    const session = sessionWithAnswer("comfort_discomfort", 3);
    expect(exportFileNameSuffix(session, "game-events", "csv", new Date(2026, 0, 5, 8))).toBe(
      "P001-game-events-20260105.csv"
    );
  });
});

describe("session zip export", () => {
  const START_ISO = "2026-08-27T17:01:14.682Z";

  /** 与实现同一方式计算的本地期望时间戳，避免测试依赖运行机器时区。 */
  function localStamp(iso: string): string {
    const d = new Date(iso);
    return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}-${String(d.getHours()).padStart(2, "0")}${String(d.getMinutes()).padStart(2, "0")}`;
  }

  it("names the zip with participant code and SessionStarted time, excluding nickname", () => {
    const session = sessionWithAnswer("comfort_discomfort", 3);
    const withStart = {
      ...session,
      auditLog: [{ id: "evt-1", type: "SessionStarted", at: START_ISO, detail: {} } as AuditEvent]
    };
    expect(exportSessionZipName(withStart)).toBe(`P001_${localStamp(START_ISO)}.zip`);
  });

  it("falls back to createdAt without a SessionStarted event", () => {
    const session = { ...sessionWithAnswer("comfort_discomfort", 3), participantProfile: { ...sessionWithAnswer("comfort_discomfort", 3).participantProfile, nickname: " 小 测:组 " } };
    expect(exportSessionZipName(session)).toBe(`P001_${localStamp("2026-08-23T00:00:00.000Z")}.zip`);
  });

  it("bundles core raw, analysis, and QC tables under participant-stamped paths", async () => {
    const session = sessionWithRuns();
    const blob = await buildSessionZip(session);
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const stamp = localStamp("2026-08-23T00:00:00.000Z");
    expect(Object.keys(zip.files).sort()).toEqual([
      "analysis/", `analysis/P001_${stamp}_objective-summary.csv`, `analysis/P001_${stamp}_subjective.csv`, `analysis/P001_${stamp}_subjective.xlsx`, "qc/", `qc/P001_${stamp}_data-quality.csv`, "raw/",
      `raw/P001_${stamp}_audit-log.csv`, `raw/P001_${stamp}_game-events.csv`, `raw/P001_${stamp}_haptic-cues.csv`, `raw/P001_${stamp}_session.json`
    ]);
    const subjective = await zip.file(`analysis/P001_${stamp}_subjective.csv`)!.async("string");
    expect(subjective.startsWith("﻿session_id,")).toBe(true);
    const parsed = JSON.parse(await zip.file(`raw/P001_${stamp}_session.json`)!.async("string")) as StudySession;
    expect(parsed.id).toBe("session-1");
  });

  it("exports four objective cells and a five-sheet workbook from persisted formal results", async () => {
    const session = completeFormalSession();
    const summary = toObjectiveSummaryCsv(session).trimEnd().split("\n");
    expect(summary).toHaveLength(5);
    expect(summary[1]).toContain(",BH,limited,1,16,15,1,0.9375,8,8,0,1,4,4,1000,2000,3000,4000,2500,2500");
    expect(summary[4]).toContain(",STH,full,2,16,15,1,0.9375,8,8,0,1,4,4,1000,2000,3000,4000,2500,2500");

    const blob = await buildSessionZip(session);
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const stamp = localStamp(NOW);
    const workbook = XLSX.read(await zip.file(`analysis/P001_${stamp}_subjective.xlsx`)!.async("arraybuffer"), { type: "array" });
    expect(workbook.SheetNames).toEqual(["Participant", "ConditionSurvey", "Suitability", "FinalEvaluation", "Interview"]);
    expect(XLSX.utils.sheet_to_json(workbook.Sheets.Participant!)).toHaveLength(1);
    expect(XLSX.utils.sheet_to_json(workbook.Sheets.ConditionSurvey!)).toHaveLength(2);
    expect(XLSX.utils.sheet_to_json(workbook.Sheets.Suitability!)).toHaveLength(9);
    expect(XLSX.utils.sheet_to_json(workbook.Sheets.FinalEvaluation!)).toHaveLength(1);
    expect(XLSX.utils.sheet_to_json(workbook.Sheets.Interview!)).toHaveLength(1);
  });
});

describe("exportSessionJson", () => {
  it("round-trips the complete session schema", () => {
    const session = sessionWithRuns();
    const parsed = JSON.parse(exportSessionJson(session)) as StudySession;
    expect(parsed.schemaVersion).toBe(3);
    expect(parsed.id).toBe("session-1");
    expect(parsed.conditionOrder).toEqual(["baseline", "spatiotemporal"]);
    expect(parsed.conditionResponses).toEqual({ baseline: { comfort_discomfort: 3 } });
    expect(parsed.conditionRuns.baseline?.attempts).toHaveLength(2);
    expect(parsed.auditLog[0]?.type).toBe("SessionStarted");
  });
});

describe("exportSessionCsv compatibility", () => {
  it("keeps the legacy subjective alias working", () => {
    expect(exportSessionCsv(sessionWithAnswer("comfort_discomfort", 3))).toContain("condition-assessment,comfort_discomfort,3");
  });
});
