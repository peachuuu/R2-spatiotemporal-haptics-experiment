# R2 Objective Data Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add append-only objective trial records, compact participant exports, and reproducible system-side derived tables without changing gameplay, haptic control, questionnaires, conditions, or trial counts.

**Architecture:** The game records a passive trial observation at each projectile, area, and chest trial boundary. The experiment system persists those observations beside existing raw game events and cue logs. Participant ZIP files retain only raw, subjective, and QC data; a Node CLI reads the ZIP and writes derived analysis tables into the system `derived/` directory.

**Tech Stack:** TypeScript, React, Vite, Vitest, JSZip, Node.js.

**Spec:** User-approved in-chat design, 2026-08-30.

## Global Constraints

- Do not change gameplay timing, collision logic, input handling, trial counts, conditions, questionnaires, or haptic scheduling.
- Keep `game-events.csv` append-only and export it unchanged in meaning.
- Use `success=1|0` only for valid trials; emit empty `success` plus `trial_valid=0` for invalid trials.
- Derive projectile reaction time only as attack start to first jump input.
- Measure area dwell/exit against the existing final hit boundary, not a new visual collision rule.
- Do not include HXI/PXI key files or derived tables in participant ZIP files.

---

### Task 1: Define passive objective-trial data and serializers

**Files:**
- Modify: `src/domain/types.ts`
- Modify: `src/domain/session.ts`
- Modify: `src/domain/objective.ts`
- Modify: `src/storage/exportSession.ts`
- Create: `src/domain/objective.test.ts`

**Interfaces:**
- Produces `ObjectiveTrialRecord`, `appendObjectiveTrial`, `toObjectiveTrialsCsv`, and `toDataQualityCsv`.
- Consumes existing `ConditionAttempt`, raw `GameEventRecord`, and haptic cue logs.

- [x] Write focused tests for valid success, invalid NA success, duplicate trial IDs, and four-cell quality counts.
- [x] Add immutable trial record types and append-only session storage.
- [x] Add deterministic serializers that preserve all attempts and calculate quality diagnostics without dropping invalid rows.
- [x] Re-run focused unit tests.

### Task 2: Add game-side passive trial observations

**Files:**
- Modify: `D:\SpiritRuins-Experiment\web\app\game\types.ts`
- Modify: `D:\SpiritRuins-Experiment\web\app\game\integrationProtocol.ts`
- Modify: `D:\SpiritRuins-Experiment\web\app\game\experimentBridge.ts`
- Modify: `D:\SpiritRuins-Experiment\web\app\components\ExperimentPage.tsx`
- Modify: `D:\SpiritRuins-Experiment\web\app\game\eventTimeline.ts`
- Create: `D:\SpiritRuins-Experiment\web\tests\objective-trials.test.ts`

**Interfaces:**
- Produces `OBJECTIVE_TRIAL` bridge messages with `trial_uid`, type-specific parameters, outcome, and validity fields.
- Consumes existing timeline start/completion, player jump, collision, chest-found, and haptic cue timing.

- [x] Add focused tests proving first-jump-only, final-boundary area, and direct-open chest fields.
- [x] Add passive state tracking that emits one final record per trial and never calls gameplay/haptic control functions.
- [x] Link each cue log to the active `trial_uid`; preserve multi-cue trials as multiple cue rows.
- [x] Run focused and full game tests.

### Task 3: Persist bridge records and make the participant ZIP compact

**Files:**
- Modify: `src/app/StudyContext.tsx`
- Modify: `src/domain/session.ts`
- Modify: `src/domain/types.ts`
- Modify: `src/storage/exportSession.ts`
- Modify: `src/screens/CompletionScreen.tsx`
- Create: `src/storage/exportSession.test.ts`

**Interfaces:**
- Consumes `OBJECTIVE_TRIAL` bridge message.
- Produces ZIP members under `raw/`, `analysis/`, and `qc/` named `P001_YYYYMMDD-HHmm_<type>.<ext>`.

- [x] Add ZIP tests for approved core members, no static/derived members, and haptic `trial_uid` linkage.
- [x] Persist bridge trial messages alongside raw logs and export the approved ZIP hierarchy.
- [x] Keep single-file export behavior compatible while adding only the required core serializers.
- [x] Run focused export tests.

### Task 4: Add references and the system-side derived-data CLI

**Files:**
- Create: `references/data-dictionary-v1.csv`
- Create: `references/hxi-key-v1.csv`
- Create: `references/pxi-key-v1.csv`
- Create: `scripts/generate-derived-data.mjs`
- Create: `scripts/generate-derived-data.test.mjs`
- Modify: `package.json`
- Create: `derived/.gitkeep`

**Interfaces:**
- Command: `npm run derive:data -- <participant-core-zip>`.
- Writes only `derived/<participant>_<timestamp>_{objective-trials,hxi,pxi,game-summary}.csv`.

- [x] Add CLI fixture tests for an input ZIP, output paths, and schema/reference version propagation.
- [x] Implement ZIP reading, validation, deterministic derived CSV output, and clear errors for missing core members.
- [x] Add versioned static reference files and package command.
- [x] Run CLI tests.

### Task 5: Document and verify collection workflow

**Files:**
- Modify: `D:\R2\docs\R2-实验系统总说明.md`
- Modify: `README.md`
- Modify/Create: relevant test fixtures

- [x] Document data meanings, NA semantics, export folders, post-session operator steps, and derived-data command.
- [x] Add a dry-run fixture that yields 112 valid planned trials across four cells plus invalid/restart coverage.
- [x] Run full R2/game test suites and production builds.
- [x] Verify persisted interview coverage through IndexedDB refresh-recovery and subjective-export tests; record its export location in the manual.
- [x] Review the requirement checklist against outputs.
