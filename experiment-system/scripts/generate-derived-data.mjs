import fs from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";

const input = process.argv[2];
if (!input) throw new Error("用法：npm run derive:data -- <核心数据.zip>");
const zip = await JSZip.loadAsync(await fs.readFile(input));
const sessionName = Object.keys(zip.files).find(name => name.endsWith("_session.json"));
if (!sessionName) throw new Error("核心数据 ZIP 缺少 raw/*_session.json");
const session = JSON.parse(await zip.file(sessionName).async("string"));
const prefix = path.basename(sessionName).replace(/_session\.json$/, "");
const coreMembers = [
  `raw/${prefix}_game-events.csv`, `raw/${prefix}_haptic-cues.csv`, `raw/${prefix}_audit-log.csv`,
  `analysis/${prefix}_subjective.csv`, `qc/${prefix}_data-quality.csv`
];
const missingMembers = coreMembers.filter(name => zip.file(name) === null);
if (missingMembers.length > 0) throw new Error(`核心数据 ZIP 缺少必需文件：${missingMembers.join("、")}`);
const out = path.resolve("derived");
await fs.mkdir(out, { recursive: true });
const esc = value => /[",\n]/.test(String(value ?? "")) ? `"${String(value ?? "").replaceAll('"', '""')}"` : String(value ?? "");
const write = async (name, columns, rows) => fs.writeFile(path.join(out, `${prefix}_${name}.csv`), [columns.join(","), ...rows.map(row => columns.map(key => esc(row[key])).join(","))].join("\n") + "\n", "utf8");
const objective = [];
const hxi = [];
const pxi = [];
const summaries = [];
for (const [conditionId, run] of Object.entries(session.conditionRuns ?? {})) {
  const responses = session.conditionResponses?.[conditionId] ?? {};
  const base = { schema_version: "objective-trials.v1", reference_version: "r2-data-references.v1", session_id: session.id, participant_code: session.participantCode, condition_id: conditionId, display_condition: run.displayCondition, game_condition_id: run.attempts?.[0]?.gameEvents?.[0]?.conditionId ?? "" };
  hxi.push({ ...base, ...Object.fromEntries(Object.entries(responses).filter(([key]) => key.startsWith("hxi_") || key === "comfort_electro" || key === "pain_electro")) });
  pxi.push({ ...base, ...Object.fromEntries(Object.entries(responses).filter(([key]) => key.startsWith("pxi_"))) });
  for (const attempt of run.attempts ?? []) {
    summaries.push({ ...base, run_id: attempt.runId, attempt_id: attempt.attemptId, status: attempt.status, started_at: attempt.startedAt, ended_at: attempt.endedAt ?? "", elapsed_ms: attempt.elapsedMs ?? "", quality_flags_json: JSON.stringify(attempt.qualityFlags ?? []), summary_json: JSON.stringify(attempt.summary ?? {}) });
    for (const trial of attempt.objectiveTrials ?? []) objective.push({ ...base, run_id: attempt.runId, attempt_id: attempt.attemptId, trial_uid: trial.trialUid, trial_type: trial.trialType, trial_index: trial.trialIndex, timeline_event_id: trial.timelineEventId, stage: trial.stage, visual_availability: trial.visualAvailability, started_at_ms: trial.startedAtMs, ended_at_ms: trial.endedAtMs, trial_valid: trial.trialValid ? 1 : 0, invalid_reason: trial.invalidReason ?? "", success: trial.success ?? "", parameters_json: JSON.stringify(trial.parameters), metrics_json: JSON.stringify(trial.metrics) });
  }
}
await write("objective-trials", ["schema_version","reference_version","session_id","participant_code","condition_id","display_condition","game_condition_id","run_id","attempt_id","trial_uid","trial_type","trial_index","timeline_event_id","stage","visual_availability","started_at_ms","ended_at_ms","trial_valid","invalid_reason","success","parameters_json","metrics_json"], objective);
await write("hxi", [...new Set(hxi.flatMap(Object.keys))], hxi);
await write("pxi", [...new Set(pxi.flatMap(Object.keys))], pxi);
await write("game-summary", ["session_id","participant_code","condition_id","display_condition","game_condition_id","run_id","attempt_id","status","started_at","ended_at","elapsed_ms","quality_flags_json","summary_json"], summaries);
console.log(`已生成 ${prefix}_objective-trials.csv、hxi.csv、pxi.csv、game-summary.csv`);
