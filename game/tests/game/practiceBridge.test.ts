import { describe, expect, it } from "vitest";
import { createPracticeBridge } from "../../app/game/practiceBridge";

describe("practice bridge", () => {
  it("publishes an authenticated STH cue request and accepts only its parent START_CUE", () => {
    const sent: Array<{ message: any; origin: string }> = [];
    const starts: number[] = [];
    const bridge = createPracticeBridge({
      sessionId: "SESSION-CUE",
      parentOrigin: "http://localhost:5173",
      emit: (message, origin) => sent.push({ message, origin }),
      onStartCue: delayMs => starts.push(delayMs),
    });

    bridge.publishCueRequest({ cueKey: "PRACTICE-PROJECTILE:projectile", baseSampleId: "sth.g07.projectile.left.fast", atMs: 123 });
    bridge.handleMessage({
      origin: "http://localhost:5173",
      data: { source: "spirit-ruins", protocolVersion: 1, sessionId: "SESSION-CUE", type: "START_CUE", payload: { delayMs: 150 } },
    });
    bridge.handleMessage({
      origin: "https://attacker.example",
      data: { source: "spirit-ruins", protocolVersion: 1, sessionId: "SESSION-CUE", type: "START_CUE", payload: { delayMs: 1 } },
    });

    expect(sent).toEqual([{ origin: "http://localhost:5173", message: {
      source: "spirit-ruins", protocolVersion: 1, sessionId: "SESSION-CUE", type: "CUE_REQUEST",
      payload: { cueKey: "PRACTICE-PROJECTILE:projectile", baseSampleId: "sth.g07.projectile.left.fast", conditionId: "STH", atMs: 123 },
    } }]);
    expect(starts).toEqual([150]);
  });

  it("publishes authenticated READY and COMPLETE once each", () => {
    const sent: Array<{ message: unknown; origin: string }> = [];
    const bridge = createPracticeBridge({
      sessionId: "SESSION-1",
      parentOrigin: "http://localhost:5173",
      emit: (message, origin) => sent.push({ message, origin }),
    });
    bridge.publishReady();
    bridge.publishReady();
    bridge.publishComplete();
    bridge.publishComplete();
    expect(sent).toEqual([
      {
        origin: "http://localhost:5173",
        message: {
          source: "spirit-ruins",
          protocolVersion: 1,
          sessionId: "SESSION-1",
          type: "PRACTICE_READY",
        },
      },
      {
        origin: "http://localhost:5173",
        message: {
          source: "spirit-ruins",
          protocolVersion: 1,
          sessionId: "SESSION-1",
          type: "PRACTICE_COMPLETE",
        },
      },
    ]);
  });

  it("reports errors only to the configured parent origin", () => {
    const sent: Array<{ message: any; origin: string }> = [];
    const bridge = createPracticeBridge({
      sessionId: "SESSION-2",
      parentOrigin: "https://study.local",
      emit: (message, origin) => sent.push({ message, origin }),
    });
    bridge.publishError("practice failed");
    expect(sent[0].origin).toBe("https://study.local");
    expect(sent[0].message).toMatchObject({
      type: "PRACTICE_ERROR",
      payload: { reason: "practice failed" },
    });
  });
});
