import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  appendAuditEvent,
  appendConditionEvent,
  appendHapticCue,
  beginConditionAttempt,
  completeConditionAttempt,
  createGameAssignment,
  createStudySession,
  interruptConditionAttempt
} from "../domain/session";
import type { ParticipantProfile } from "../domain/types";
import type { AnswerValue, ConditionId, GameEventRecord, HapticCueLog, SkipInput, StepId, StudyMode, StudySession, TimelineEventRecord } from "../domain/types";
import type { GameLaunchPayload } from "../integration/gameProtocol";
import { IndexedDbStudyRepository } from "../storage/IndexedDbStudyRepository";
import type { StudyRepository } from "../storage/StudyRepository";
import { advance as machineAdvance, navigateToStep, skip as machineSkip, stepValidity } from "./studyMachine";

/** What BasicInfoScreen submits; the counterbalance cell is allocated, never chosen. */
export type StartInput = {
  participantCode: string;
  studyMode: StudyMode;
  profile: ParticipantProfile;
};

export type ConditionTerminalResult = {
  status: "won";
  elapsedMs: number;
  realizedStageOrder?: string[];
  timelineEvents?: TimelineEventRecord[];
};

export type StudyContextValue = {
  session: StudySession | null;
  incompleteSessions: StudySession[];
  loading: boolean;
  /** Allocates a balanced counterbalance cell, creates and persists the session. */
  start: (input: StartInput) => Promise<void>;
  /** Starts a blank dry-run draft in memory so the table of contents is available; never saved or allocated. */
  startDraft: () => Promise<void>;
  resume: (id: string) => Promise<void>;
  /** Persist a pure update of the current session and stamp `updatedAt`. */
  update: (fn: (session: StudySession) => StudySession) => Promise<void>;
  advance: (stepId: StepId) => Promise<void>;
  skip: (stepId: StepId, input: SkipInput) => Promise<void>;
  /** 目录回退导航：只能回到已到达过的步骤。 */
  goToStep: (stepId: StepId) => Promise<void>;
  /** Append an AdapterAction audit event. */
  logAdapter: (adapter: string, action: string, detail?: Record<string, AnswerValue>) => Promise<void>;
  /** Begin (or recover) the embedded game run for one condition. */
  startConditionAttempt: (conditionId: ConditionId, launch: GameLaunchPayload) => Promise<void>;
  /** Persist one deduplicated objective game event into the active attempt. */
  recordGameEvent: (conditionId: ConditionId, record: GameEventRecord) => Promise<void>;
  /** Append/update one haptic cue synchronization record into the active attempt. */
  logHapticCue: (conditionId: ConditionId, cue: HapticCueLog) => Promise<void>;
  /** Close the active attempt after a validated winning result. */
  completeCondition: (conditionId: ConditionId, result: ConditionTerminalResult) => Promise<void>;
  /** Mark the active attempt interrupted without advancing the workflow. */
  interruptCondition: (conditionId: ConditionId, reason: string) => Promise<void>;
  /** Return to the session gate; state is already persisted on every action. */
  saveAndExit: () => Promise<void>;
};

const StudyContext = createContext<StudyContextValue | null>(null);

export function StudyProvider({ children, repository }: { children: ReactNode; repository?: StudyRepository }) {
  const repo = useMemo(() => repository ?? new IndexedDbStudyRepository(), [repository]);
  const [session, setSession] = useState<StudySession | null>(null);
  const [incompleteSessions, setIncompleteSessions] = useState<StudySession[]>([]);
  const [loading, setLoading] = useState(true);
  const sessionRef = useRef<StudySession | null>(null);
  const commitQueueRef = useRef<Promise<void>>(Promise.resolve());
  // NOTE: sessionRef is written only synchronously in start/resume/commit/saveAndExit.
  // A useEffect sync would race with in-flight commits: while commit awaits its
  // IndexedDB save, React can flush an earlier render whose effect would write
  // stale state back into the ref.

  const refreshIncomplete = useCallback(async () => {
    setIncompleteSessions(await repo.listIncomplete());
  }, [repo]);

  useEffect(() => {
    let cancelled = false;
    void repo.listIncomplete().then(list => {
      if (cancelled) return;
      setIncompleteSessions(list);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [repo]);

  /**
   * Serialized commit queue: rapid GAME_EVENT bursts persist strictly in
   * order, so a later save can never finish before an earlier one.
   */
  const commit = useCallback(
    (fn: (current: StudySession) => StudySession) => {
      const run = async () => {
        const current = sessionRef.current;
        if (current === null) return;
        const next: StudySession = { ...fn(current), updatedAt: new Date().toISOString() };
        sessionRef.current = next;
        await repo.save(next);
        setSession(next);
      };
      const queued = commitQueueRef.current.then(run, run);
      commitQueueRef.current = queued.catch(() => undefined);
      return queued;
    },
    [repo]
  );

  const start = useCallback(
    async (input: StartInput) => {
      const now = new Date().toISOString();
      await Promise.all(
        incompleteSessions
          .filter(s => s.id !== sessionRef.current?.id)
          .map(s => repo.save({ ...s, status: "abandoned" as const, updatedAt: now }))
      );
      // The allocation and the session save are separate transactions by
      // design: an allocated cell is never silently reused, and a session
      // that fails to save does not consume a second allocation on retry.
      const allocation = await repo.allocateConditionOrder();
      const created = createStudySession(
        {
          participantCode: input.participantCode,
          studyMode: input.studyMode,
          allocation: {
            counterbalanceCell: allocation.counterbalanceCell,
            metadata: allocation.allocation
          },
          gameAssignment: createGameAssignment(),
          profile: input.profile
        },
        now
      );
      sessionRef.current = created;
      await repo.save(created);
      setSession(created);
      await refreshIncomplete();
    },
    [incompleteSessions, refreshIncomplete, repo]
  );

  const startDraft = useCallback(() => {
    const now = new Date().toISOString();
    // In-memory navigation draft: blockId 0 marks it as never allocated.
    const draft = createStudySession(
      {
        participantCode: "DRAFT",
        studyMode: "dry-run",
        allocation: {
          counterbalanceCell: "AB",
          metadata: { methodVersion: "balanced-block-v1", blockId: 0, position: 0 }
        },
        gameAssignment: createGameAssignment(),
        profile: { nickname: "", age: 0, gender: "", hapticExperience: "" }
      },
      now
    );
    sessionRef.current = draft;
    setSession(draft);
    return Promise.resolve();
  }, []);

  const resume = useCallback(
    async (id: string) => {
      const found = await repo.get(id);
      if (found === undefined) throw new Error(`session ${id} not found`);
      sessionRef.current = found;
      setSession(found);
    },
    [repo]
  );

  const update = useCallback((fn: (current: StudySession) => StudySession) => commit(fn), [commit]);

  const advance = useCallback(
    async (stepId: StepId) => {
      const current = sessionRef.current;
      if (current === null || stepId !== current.currentStepId) return; // stale double-submit guard
      const validity = stepValidity(current, stepId);
      await commit(s => machineAdvance(s, { stepId, valid: validity.valid }));
    },
    [commit]
  );

  const skip = useCallback(
    async (stepId: StepId, input: SkipInput) => {
      const current = sessionRef.current;
      if (current === null || stepId !== current.currentStepId) return;
      await commit(s => machineSkip(s, stepId, input));
    },
    [commit]
  );

  const goToStep = useCallback(
    async (stepId: StepId) => {
      const current = sessionRef.current;
      if (current === null) return;
      await commit(s => navigateToStep(s, stepId));
    },
    [commit]
  );

  const logAdapter = useCallback(
    (adapter: string, action: string, detail: Record<string, AnswerValue> = {}) =>
      commit(s =>
        appendAuditEvent(s, { type: "AdapterAction", detail: { adapter, action, ...detail } }, new Date().toISOString())
      ),
    [commit]
  );

  const startConditionAttempt = useCallback(
    (conditionId: ConditionId, launch: GameLaunchPayload) =>
      commit(s => beginConditionAttempt(s, conditionId, launch)),
    [commit]
  );

  const recordGameEvent = useCallback(
    (conditionId: ConditionId, record: GameEventRecord) =>
      commit(s => appendConditionEvent(s, conditionId, record)),
    [commit]
  );

  const logHapticCue = useCallback(
    (conditionId: ConditionId, cue: HapticCueLog) =>
      commit(s => appendHapticCue(s, conditionId, cue)),
    [commit]
  );

  const completeCondition = useCallback(
    (conditionId: ConditionId, result: ConditionTerminalResult) =>
      commit(s => completeConditionAttempt(s, conditionId, result)),
    [commit]
  );

  const interruptCondition = useCallback(
    (conditionId: ConditionId, reason: string) =>
      commit(s => interruptConditionAttempt(s, conditionId, reason)),
    [commit]
  );

  const saveAndExit = useCallback(async () => {
    sessionRef.current = null;
    setSession(null);
    await refreshIncomplete();
  }, [refreshIncomplete]);

  const value = useMemo<StudyContextValue>(
    () => ({
      session,
      incompleteSessions,
      loading,
      start,
      startDraft,
      resume,
      update,
      advance,
      skip,
      goToStep,
      logAdapter,
      startConditionAttempt,
      recordGameEvent,
      logHapticCue,
      completeCondition,
      interruptCondition,
      saveAndExit
    }),
    [session, incompleteSessions, loading, start, startDraft, resume, update, advance, skip, goToStep, logAdapter, startConditionAttempt, recordGameEvent, logHapticCue, completeCondition, interruptCondition, saveAndExit]
  );

  return <StudyContext.Provider value={value}>{children}</StudyContext.Provider>;
}

export function useStudy(): StudyContextValue {
  const ctx = useContext(StudyContext);
  if (ctx === null) throw new Error("useStudy must be used inside StudyProvider");
  return ctx;
}
