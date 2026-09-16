import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { EmbeddedPracticeRunner } from "../../src/components/EmbeddedPracticeRunner";
import { GAME_ORIGIN } from "../../src/integration/gameProtocol";

const SESSION_ID = "session-practice-1";

function post(data: unknown, origin: string = GAME_ORIGIN) {
  act(() => {
    window.dispatchEvent(new MessageEvent("message", { origin, source: null, data }));
  });
}

function practiceMessage(type: string, sessionId = SESSION_ID, payload?: unknown) {
  return { source: "spirit-ruins", protocolVersion: 1, sessionId, type, payload };
}

describe("embedded practice runner", () => {
  it("routes a valid practice cue through the supplied STH cue handler and starts the game", async () => {
    const onCueRequest = vi.fn().mockResolvedValue({ delayMs: 137 });
    render(<EmbeddedPracticeRunner sessionId={SESSION_ID} onComplete={() => undefined} onCueRequest={onCueRequest} />);
    const frame = screen.getByTestId("practice-frame") as HTMLIFrameElement;
    const postMessage = vi.spyOn(frame.contentWindow!, "postMessage");

    post(practiceMessage("CUE_REQUEST", SESSION_ID, {
      cueKey: "PRACTICE-AREA:area", baseSampleId: "sth.g07.area.b.fast", conditionId: "STH", atMs: 3200,
    }));

    await vi.waitFor(() => expect(postMessage).toHaveBeenCalledWith({
      source: "spirit-ruins", protocolVersion: 1, sessionId: SESSION_ID,
      type: "START_CUE", payload: { delayMs: 137 },
    }, GAME_ORIGIN));
    expect(onCueRequest).toHaveBeenCalledWith({
      cueKey: "PRACTICE-AREA:area", baseSampleId: "sth.g07.area.b.fast", conditionId: "STH", atMs: 3200,
    });
  });

  it("builds the full practice URL with session id and parent origin", () => {
    render(<EmbeddedPracticeRunner sessionId={SESSION_ID} onComplete={() => undefined} />);
    const frame = screen.getByTestId("practice-frame") as HTMLIFrameElement;
    const url = new URL(frame.src);
    expect(url.origin).toBe(GAME_ORIGIN);
    expect(url.searchParams.get("mode")).toBe("practice");
    expect(url.searchParams.get("embedded")).toBe("1");
    expect(url.searchParams.get("sessionId")).toBe(SESSION_ID);
    expect(url.searchParams.get("parentOrigin")).toBe(location.origin);
  });

  it("consumes PRACTICE_READY and completes exactly once on PRACTICE_COMPLETE", () => {
    const onComplete = vi.fn();
    render(<EmbeddedPracticeRunner sessionId={SESSION_ID} onComplete={onComplete} />);

    post(practiceMessage("PRACTICE_READY"));
    expect(screen.getByText(/练习已就绪/)).toBeInTheDocument();

    post(practiceMessage("PRACTICE_COMPLETE"));
    post(practiceMessage("PRACTICE_COMPLETE"));
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/练习已完成/)).toBeInTheDocument();
  });

  it("ignores wrong-origin, wrong-session and foreign messages", () => {
    const onComplete = vi.fn();
    const onDiagnostic = vi.fn();
    render(<EmbeddedPracticeRunner sessionId={SESSION_ID} onComplete={onComplete} onDiagnostic={onDiagnostic} />);

    post(practiceMessage("PRACTICE_COMPLETE"), "https://attacker.example");
    post(practiceMessage("PRACTICE_COMPLETE", "OTHER-SESSION"));
    post({ source: "spirit-ruins", protocolVersion: 2, sessionId: SESSION_ID, type: "PRACTICE_COMPLETE" });
    post({ source: "evil", protocolVersion: 1, sessionId: SESSION_ID, type: "PRACTICE_COMPLETE" });
    post("not an object");

    expect(onComplete).not.toHaveBeenCalled();
    expect(onDiagnostic.mock.calls.length).toBeGreaterThanOrEqual(4);
  });

  it("shows a recoverable error for PRACTICE_ERROR and retries", async () => {
    const onComplete = vi.fn();
    render(<EmbeddedPracticeRunner sessionId={SESSION_ID} onComplete={onComplete} />);

    post(practiceMessage("PRACTICE_ERROR", SESSION_ID, { reason: "haptic adapter missing" }));
    expect(screen.getByText(/haptic adapter missing/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /重试加载练习/ })).toBeInTheDocument();
    expect(onComplete).not.toHaveBeenCalled();

    // After a retry remount the runner accepts a fresh completion.
    await userEvent.click(screen.getByRole("button", { name: /重试加载练习/ }));
    post(practiceMessage("PRACTICE_COMPLETE"));
    expect(onComplete).toHaveBeenCalledTimes(1);
  });
});
