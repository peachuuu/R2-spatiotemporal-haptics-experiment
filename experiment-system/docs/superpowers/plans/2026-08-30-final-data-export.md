# R2 Final Data Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make participant exports directly usable for formal data collection while preserving the existing gameplay, haptic hardware, and raw logs.

**Architecture:** The game records chest audio-onset and successful-interaction timestamps in the existing passive objective-trial payload. The experiment system derives an exact four-row objective summary and a five-sheet subjective workbook from persisted session data during ZIP export; raw session, event, cue, audit, and QC exports remain unchanged.

**Tech Stack:** TypeScript, Vitest, JSZip, SheetJS `xlsx`.

**Spec:** User-approved final data-export proposal, 2026-08-30.

## Global Constraints

- Do not modify gameplay flow, event timing, player input, haptic sample scheduling, hardware connection, calibration, or questionnaires.
- Preserve all current raw ZIP members and data meanings.
- Chest completion is `successful_interaction_time_ms - actual_prompt_audio_onset_ms` for G05, G07-CHEST01–03, G09, and G11-CHEST01–03.
- `objective-summary.csv` has exactly BH/limited, BH/full, STH/limited, STH/full rows for a complete session.
- `subjective.xlsx` contains Participant, ConditionSurvey, Suitability, FinalEvaluation, and Interview sheets.

---

### Task 1: Normalize passive chest timestamps

**Files:**
- Modify: `D:\SpiritRuins-Experiment\web\app\game\chestTrials.ts`
- Modify: `D:\SpiritRuins-Experiment\web\app\game\objectiveTrials.ts`
- Test: `D:\SpiritRuins-Experiment\web\tests\game\objectiveTrials.test.ts`

- [x] Write failing tests for prompt audio onset, successful interaction time, and completion arithmetic.
- [x] Implement timestamp propagation without changing event playback or interaction behavior.
- [x] Run the focused game test.

### Task 2: Export four-cell objective summary

**Files:**
- Modify: `D:\R2\experiment-system\src\storage\exportSession.ts`
- Test: `D:\R2\experiment-system\tests\unit\exportSession.test.ts`

- [x] Write failing ZIP-level tests for four objective rows, planned totals, result arithmetic, and chest completion statistics.
- [x] Add the pure summary serializer and ZIP member.
- [x] Run the focused R2 export test.

### Task 3: Export participant-level subjective workbook

**Files:**
- Modify: `D:\R2\experiment-system\package.json`
- Modify: `D:\R2\experiment-system\src\storage\exportSession.ts`
- Test: `D:\R2\experiment-system\tests\unit\exportSession.test.ts`

- [x] Install SheetJS and write failing ZIP/workbook sheet and row-count tests.
- [x] Add workbook generation from persisted responses and ZIP member.
- [x] Verify workbook values against the test session.

### Task 4: Document and verify a complete export

**Files:**
- Modify: `D:\R2\docs\R2-实验系统总说明.md`
- Modify: `D:\R2\experiment-system\README.md`

- [x] Document definitions, output paths, and analysis workflow.
- [x] Run full test suites and production builds for R2 and the game.
- [x] Run a representative complete-session ZIP inspection covering raw members, summary arithmetic, and workbook sheets.
