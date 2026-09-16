import { useState } from "react";
import { StepFrame, stepTitle } from "../components/StepFrame";
import { StepNavigationDialog } from "../components/StepNavigationDialog";
import { GamepadPointer } from "../components/GamepadPointer";
import { pageGamepadPointerEnabled } from "../input/gamepadPointerScope";
import type { StepId, StudySession } from "../domain/types";
import type { StudyRepository } from "../storage/StudyRepository";
import { BasicInfoScreen } from "../screens/BasicInfoScreen";
import { CalibrationScreen } from "../screens/CalibrationScreen";
import { CompletionScreen } from "../screens/CompletionScreen";
import { ConditionAssessmentScreen } from "../screens/ConditionAssessmentScreen";
import { ConditionScreen } from "../screens/ConditionScreen";
import { ConsentScreen } from "../screens/ConsentScreen";
import { FinalAssessmentScreen } from "../screens/FinalAssessmentScreen";
import { InstructionScreen } from "../screens/InstructionScreen";
import { InterviewScreen } from "../screens/InterviewScreen";
import { SampleComparisonScreen } from "../screens/SampleComparisonScreen";
import { GAME_STEP_IDS, SKIPPABLE_STEPS } from "./studyMachine";
import { HardwareHostFrame } from "../integration/HardwareHostFrame";
import { StudyProvider, useStudy } from "./StudyContext";

export default function App({ repository }: { repository?: StudyRepository }) {
  return (
    <StudyProvider repository={repository}>
      <StudyShell />
    </StudyProvider>
  );
}

function StudyShell() {
  const { session, incompleteSessions, loading, resume, startDraft } = useStudy();
  const [newSessionRequested, setNewSessionRequested] = useState(false);
  const [tocOpen, setTocOpen] = useState(false);
  const openToc = async () => {
    if (session === null) await startDraft();
    setTocOpen(true);
  };
  // Game steps (instruction/condition-1/condition-2) get the wide layout;
  // questionnaire and reading steps keep the ~960px width.
  const isGameStep = session !== null && GAME_STEP_IDS.includes(session.currentStepId);

  return (
    <div className={`app${isGameStep ? " app--game-step" : ""}`}>
      {pageGamepadPointerEnabled(session?.currentStepId) && <GamepadPointer />}
      <HardwareHostFrame sessionId={session?.id ?? null}>
      <header className="app-header">
        <div className="app-header-row">
          <div>
            <h1>电触觉游戏实验</h1>
            <p className="app-subtitle">实验流程系统 —— 空间位置游戏触觉设计</p>
          </div>
          <button type="button" className="button button-secondary" onClick={() => void openToc()}>
            目录
          </button>
        </div>
      </header>
      <main className="app-main">
        {loading ? (
          <p role="status">正在加载本地会话存储…</p>
        ) : session !== null ? (
          <ActiveSession session={session} />
        ) : newSessionRequested || incompleteSessions.length === 0 ? (
          <StartSession onBack={incompleteSessions.length > 0 ? () => setNewSessionRequested(false) : undefined} />
        ) : (
          <SessionGate
            sessions={incompleteSessions}
            onNew={() => setNewSessionRequested(true)}
            onResume={id => void resume(id)}
          />
        )}
      </main>
      {tocOpen && session !== null && <StepNavigationDialog onClose={() => setTocOpen(false)} />}
      </HardwareHostFrame>
    </div>
  );
}

function StartSession({ onBack }: { onBack?: () => void }) {
  return (
    <section>
      {onBack !== undefined && (
        <button type="button" className="button button-ghost" onClick={onBack}>
          ← 返回
        </button>
      )}
      <BasicInfoScreen />
    </section>
  );
}

function SessionGate({
  sessions,
  onNew,
  onResume
}: {
  sessions: StudySession[];
  onNew: () => void;
  onResume: (id: string) => void;
}) {
  return (
    <section className="session-gate">
      <h2>继续或开始会话</h2>
      <p className="screen-intro">
        此浏览器中有一个或多个进行中的会话。继续会话将从已保存的精确步骤恢复，且不会改变条件顺序。
      </p>
      <ul className="session-list">
        {sessions.map(session => (
          <li key={session.id} className="session-list-item">
            <span>
              会话 {session.participantCode} —— 步骤：{session.currentStepId} —— 模式：{session.studyMode}
            </span>
            <button type="button" className="button button-primary" onClick={() => onResume(session.id)}>
              继续会话 {session.participantCode}
            </button>
          </li>
        ))}
      </ul>
      <button type="button" className="button button-secondary" onClick={onNew}>
        开始另一个会话
      </button>
    </section>
  );
}

function ActiveSession({ session }: { session: StudySession }) {
  const step = session.currentStepId;
  return (
    <StepFrame stepId={step} title={stepTitle(session, step)} skippable={SKIPPABLE_STEPS.includes(step)}>
      <StepContent session={session} step={step} />
    </StepFrame>
  );
}

function StepContent({ session, step }: { session: StudySession; step: StepId }) {
  switch (step) {
    case "basic-info":
      return <BasicInfoScreen />;
    case "consent":
      return <ConsentScreen />;
    case "calibration":
      return <CalibrationScreen />;
    case "instruction":
      return <InstructionScreen />;
    case "condition-1":
      return <ConditionScreen conditionIndex={0} />;
    case "assessment-1":
      return <ConditionAssessmentScreen conditionIndex={0} />;
    case "condition-2":
      return <ConditionScreen conditionIndex={1} />;
    case "assessment-2":
      return <ConditionAssessmentScreen conditionIndex={1} />;
    case "comparison":
      return <SampleComparisonScreen />;
    case "final":
      return <FinalAssessmentScreen />;
    case "interview":
      return <InterviewScreen />;
    case "completion":
      return <CompletionScreen />;
    default:
      return null;
  }
}
