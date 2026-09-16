import { useStudy } from "../app/StudyContext";
import { EmbeddedPracticeRunner } from "../components/EmbeddedPracticeRunner";
import { INSTRUCTION } from "../protocol/instructions.v1";
import { useHardwareHostClient } from "../integration/HardwareHostFrame";
import { orchestratePracticeCue } from "../integration/practiceCueOrchestrator";

/**
 * 操作说明 + 真实游戏练习。练习以 iframe 嵌入游戏（origin 校验、会话校验），
 * 只有收到合法的 PRACTICE_COMPLETE 才推进到第一个正式实验条件；
 * 不要求完成三个练习项目。
 */
export function InstructionScreen() {
  const { session, advance, logAdapter } = useStudy();
  const hostClient = useHardwareHostClient();
  if (session === null) return null;

  return (
    <div>
      <h3>{INSTRUCTION.title}</h3>
      {INSTRUCTION.sections.map(section => (
        <section key={section.heading} className="instruction-section">
          <h4>{section.heading}</h4>
          <p>{section.body}</p>
        </section>
      ))}
      <EmbeddedPracticeRunner
        sessionId={session.id}
        onComplete={() => void advance("instruction")}
        onCueRequest={async request => {
          if (session.studyMode !== "production") return { delayMs: 0 };
          if (hostClient === null) return { error: "硬件连接未建立" };
          const result = await orchestratePracticeCue(hostClient, request);
          void logAdapter("haptic", "practice-cue", {
            cueKey: request.cueKey,
            baseSampleId: request.baseSampleId,
            outcome: "error" in result ? "error" : "ok",
            ...("error" in result ? { reason: result.error } : { delayMs: result.delayMs }),
          });
          return result;
        }}
        onDiagnostic={detail => {
          void logAdapter("game", "practice-diagnostic", detail);
        }}
      />
    </div>
  );
}
