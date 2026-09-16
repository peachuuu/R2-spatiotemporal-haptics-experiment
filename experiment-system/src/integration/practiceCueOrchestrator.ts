import type { CueHost } from "./cueOrchestrator";

/** Practice-only STH path; mirrors formal PREPARE -> COMMIT timing without reading a formal condition. */
export async function orchestratePracticeCue(
  host: CueHost,
  request: { cueKey: string; baseSampleId: string; atMs: number },
  leadMs = 150,
): Promise<{ delayMs: number } | { error: string }> {
  if (!request.baseSampleId.startsWith("sth.")) return { error: "练习只允许 STH 样本" };
  const prepared = await host.prepareSample(request.baseSampleId, 7000);
  if (!prepared.ok) return { error: prepared.error.message };
  const cueAt = performance.now() + leadMs;
  const delayMs = Math.max(0, Math.round(cueAt - performance.now()));
  void host.commitAfter(delayMs, 8000);
  return { delayMs };
}
