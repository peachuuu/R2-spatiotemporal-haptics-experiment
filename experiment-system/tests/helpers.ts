import { createStudySession } from "../src/domain/session";
import type { StudySession } from "../src/domain/types";

export const NOW = "2026-08-26T00:00:00.000Z";

export const PROFILE = {
  nickname: "小测",
  age: 22,
  gender: "male",
  hapticExperience: "never"
} as const;

/** Schema-v2 session built through the real constructor. */
export function makeTestSession(
  cell: "AB" | "BA" = "AB",
  overrides: Partial<StudySession> = {},
  now: string = NOW
): StudySession {
  const session = createStudySession(
    {
      participantCode: "P001",
      studyMode: "dry-run",
      allocation: {
        counterbalanceCell: cell,
        metadata: { methodVersion: "balanced-block-v1", blockId: 1, position: cell === "AB" ? 0 : 1 }
      },
      gameAssignment: {
        timelineSeed: "TEST-SEED",
        projectileSequenceId: "S1",
        areaSequenceId: "A1"
      },
      profile: { ...PROFILE }
    },
    now
  );
  return { ...session, ...overrides };
}
