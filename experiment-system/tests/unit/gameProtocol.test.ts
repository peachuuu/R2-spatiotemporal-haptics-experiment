import { describe, expect, it } from "vitest";
import {
  createConditionLaunch,
  createConditionUrl,
  createPracticeUrl,
  createStartRunMessage,
  eventKey,
  GAME_ORIGIN,
  GAME_PROTOCOL_VERSION,
  inputMethodsOf,
  isGameMessage,
  isPracticeMessage,
  isValidRunCompletePayload,
  summarizeAttempt,
  toGameCondition
} from "../../src/integration/gameProtocol";
import { createStudySession } from "../../src/domain/session";
import type { GameEventRecord, StudySession } from "../../src/domain/types";

const NOW = "2026-08-26T00:00:00.000Z";

function makeSession(cell: "AB" | "BA"): StudySession {
  return createStudySession(
    {
      participantCode: "P001",
      studyMode: "production",
      allocation: {
        counterbalanceCell: cell,
        metadata: { methodVersion: "balanced-block-v1", blockId: 1, position: 0 }
      },
      gameAssignment: {
        timelineSeed: "SEED-1",
        projectileSequenceId: "S2",
        areaSequenceId: "A3"
      },
      profile: { nickname: "小测", age: 22, gender: "male", hapticExperience: "never" }
    },
    NOW
  );
}

describe("game protocol mapping", () => {
  it("maps hidden conditions and preserves a shared timeline seed", () => {
    const session = makeSession("AB");
    const a = createConditionLaunch(session, 0, "http://localhost:5173");
    const b = createConditionLaunch(session, 1, "http://localhost:5173");
    expect([a.conditionId, b.conditionId].sort()).toEqual(["BH", "STH"]);
    expect(a.timelineSeed).toBe(b.timelineSeed);
    expect(a.projectileSequenceId).toBe(b.projectileSequenceId);
    expect(a.areaSequenceId).toBe(b.areaSequenceId);
    expect(a.runId).not.toBe(b.runId);
  });

  it("maps baseline to BH and spatiotemporal to STH", () => {
    expect(toGameCondition("baseline")).toBe("BH");
    expect(toGameCondition("spatiotemporal")).toBe("STH");
  });

  it("builds the practice URL with the full embedded parameter set", () => {
    const url = createPracticeUrl("S-123", "http://localhost:5173");
    const parsed = new URL(url);
    expect(parsed.origin).toBe(GAME_ORIGIN);
    expect(parsed.searchParams.get("mode")).toBe("practice");
    expect(parsed.searchParams.get("embedded")).toBe("1");
    expect(parsed.searchParams.get("sessionId")).toBe("S-123");
    expect(parsed.searchParams.get("parentOrigin")).toBe("http://localhost:5173");
  });

  it("builds the condition URL with timeline seed and sequences", () => {
    const session = makeSession("BA");
    const url = createConditionUrl(createConditionLaunch(session, 0, "http://localhost:5173"));
    const parsed = new URL(url);
    expect(parsed.searchParams.get("mode")).toBe("experiment");
    expect(parsed.searchParams.get("condition")).toBe("STH");
    expect(parsed.searchParams.get("timelineSeed")).toBe("SEED-1");
    expect(parsed.searchParams.get("projectileSequence")).toBe("S2");
    expect(parsed.searchParams.get("areaSequence")).toBe("A3");
    expect(parsed.searchParams.get("parentOrigin")).toBe("http://localhost:5173");
    expect(parsed.searchParams.get("runId")).toBe(`${session.id}-C1`);
  });
});

describe("message guards", () => {
  it("accepts only authenticated practice messages for the session", () => {
    expect(
      isPracticeMessage({ source: "spirit-ruins", protocolVersion: 1, sessionId: "S", type: "PRACTICE_READY" }, "S")
    ).toBe(true);
    expect(
      isPracticeMessage({ source: "spirit-ruins", protocolVersion: 1, sessionId: "OTHER", type: "PRACTICE_COMPLETE" }, "S")
    ).toBe(false);
    expect(
      isPracticeMessage({ source: "spirit-ruins", protocolVersion: 2, sessionId: "S", type: "PRACTICE_COMPLETE" }, "S")
    ).toBe(false);
    expect(
      isPracticeMessage({ source: "evil", protocolVersion: 1, sessionId: "S", type: "PRACTICE_COMPLETE" }, "S")
    ).toBe(false);
    expect(isPracticeMessage(null, "S")).toBe(false);
  });

  it("accepts only authenticated game messages for the session and run", () => {
    const base = { source: "spirit-ruins", protocolVersion: GAME_PROTOCOL_VERSION, sessionId: "S", runId: "R", type: "GAME_READY" };
    expect(isGameMessage(base, "S", "R")).toBe(true);
    expect(isGameMessage({ ...base, runId: "R2" }, "S", "R")).toBe(false);
    expect(isGameMessage({ ...base, type: "START_RUN" }, "S", "R")).toBe(false);
  });

  it("accepts an authenticated request to skip a failed cue after hardware resynchronization", () => {
    const recovery = {
      source: "spirit-ruins",
      protocolVersion: GAME_PROTOCOL_VERSION,
      sessionId: "S",
      runId: "R",
      type: "CUE_RECOVERY_REQUEST",
      payload: { eventId: "G07-P02", atMs: 1200 }
    };
    expect(isGameMessage(recovery, "S", "R")).toBe(true);
  });

  it("validates RUN_COMPLETE identity, shared seed and won status", () => {
    const session = makeSession("AB");
    const launch = createConditionLaunch(session, 0, "http://localhost:5173");
    const valid = {
      source: "spirit-ruins",
      protocolVersion: GAME_PROTOCOL_VERSION,
      sessionId: session.id,
      runId: launch.runId,
      type: "RUN_COMPLETE",
      payload: {
        status: "won",
        sessionId: session.id,
        runId: launch.runId,
        conditionId: "BH",
        projectileSequenceId: "S2",
        areaSequenceId: "A3",
        timelineSeed: "SEED-1"
      }
    };
    expect(isValidRunCompletePayload(valid as never, launch)).toBe(true);
    expect(isValidRunCompletePayload({ ...valid, payload: { ...valid.payload, status: "aborted" } } as never, launch)).toBe(false);
    expect(isValidRunCompletePayload({ ...valid, payload: { ...valid.payload, timelineSeed: "OTHER" } } as never, launch)).toBe(false);
    expect(isValidRunCompletePayload({ ...valid, payload: {} } as never, launch)).toBe(false);
  });

  it("issues START_RUN with the full launch identity", () => {
    const session = makeSession("AB");
    const launch = createConditionLaunch(session, 0, "http://localhost:5173");
    const message = createStartRunMessage(launch);
    expect(message).toMatchObject({
      source: "spirit-ruins",
      protocolVersion: 1,
      sessionId: session.id,
      runId: launch.runId,
      type: "START_RUN"
    });
  });
});

describe("objective event utilities", () => {
  function sample(over: Partial<GameEventRecord> = {}): GameEventRecord {
    return {
      sessionId: "S",
      runId: "R",
      conditionId: "BH",
      projectileSequenceId: "S2",
      areaSequenceId: "A3",
      eventId: "boss-landing",
      outcome: "shown",
      atMs: 100,
      phase: "intro",
      ...over
    };
  }

  it("derives stable dedup keys", () => {
    const a = sample();
    const b = sample();
    expect(eventKey(a)).toBe(eventKey(b));
    expect(eventKey({ ...a, atMs: 5 })).not.toBe(eventKey(a));
    expect(eventKey({ ...a, outcome: "hit" })).not.toBe(eventKey(a));
  });

  it("summarizes hits, evades and mean reaction time", () => {
    const events = [
      sample({ eventId: "projectile-evaded", reactionTimeMs: 400 }),
      sample({ eventId: "projectile-evaded", reactionTimeMs: 600 }),
      sample({ eventId: "player-hit", sourceEventId: "projectile-left-low" }),
      sample({ eventId: "area-escaped" }),
      sample({ eventId: "input-keyboard" }),
      sample({ eventId: "input-gamepad" })
    ];
    expect(summarizeAttempt(events)).toEqual({
      totalEvents: 6,
      projectileHits: 1,
      projectileEvades: 2,
      areaHits: 0,
      areaEscapes: 1,
      meanAvailableReactionTimeMs: 500,
      chestTrialsCompleted: 0,
      meanChestSearchTimeMs: "",
      chestCueToInteractMs: "",
      emergencySkips: 0
    });
    expect(inputMethodsOf(events).sort()).toEqual(["gamepad", "keyboard"]);
  });

  it("summarizes every chest trial from its directly logged search time", () => {
    const events = [
      sample({ eventId: "chest-found", timelineEventId: "G05", trialIndex: 1, reactionTimeMs: 1200 }),
      sample({ eventId: "chest-found", timelineEventId: "G07-CHEST01", trialIndex: 2, reactionTimeMs: 1800 }),
      sample({ eventId: "chest-found", timelineEventId: "G07-CHEST02", trialIndex: 3, reactionTimeMs: 2400 }),
      sample({ eventId: "chest-found", timelineEventId: "G07-CHEST03", trialIndex: 4, reactionTimeMs: 3000 })
    ];
    expect(summarizeAttempt(events)).toMatchObject({
      chestTrialsCompleted: 4,
      meanChestSearchTimeMs: 2100,
      chestCueToInteractMs: 2100
    });
  });
});
