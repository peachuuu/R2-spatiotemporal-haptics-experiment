import { afterEach, describe, expect, it, vi } from "vitest";
import { playComparisonSample, type ComparisonPlaybackHost } from "../../src/integration/comparisonPlayer";

function fakeHost(durationUs = 2_000_000): ComparisonPlaybackHost & {
  prepareSample: ReturnType<typeof vi.fn>;
  commitAfter: ReturnType<typeof vi.fn>;
  emergencyStop: ReturnType<typeof vi.fn>;
  arm: ReturnType<typeof vi.fn>;
} {
  return {
    prepareSample: vi.fn(async () => ({ ok: true as const, value: { sampleId: "sth.g03.fire", durationUs } })),
    commitAfter: vi.fn(async () => ({ ok: true as const, value: { deviceStartUs: 12345 } })),
    emergencyStop: vi.fn(async () => ({ ok: true as const, value: undefined })),
    arm: vi.fn(async () => ({ ok: true as const, value: undefined }))
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("playComparisonSample", () => {
  it("先 PREPARE，成功后按 leadMs 相对延迟 COMMIT，在共同起播点回调 onStarted", async () => {
    vi.useFakeTimers();
    const host = fakeHost(2_000_000);
    const onStarted = vi.fn();
    const onFinished = vi.fn();
    const onError = vi.fn();
    playComparisonSample(host, { resolvedSampleId: "sth.g03.fire", leadMs: 150, onStarted, onFinished, onError });

    await vi.advanceTimersByTimeAsync(0); // flush prepare 微任务
    expect(host.prepareSample).toHaveBeenCalledWith("sth.g03.fire", 4000);
    expect(onStarted).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(150);
    expect(host.commitAfter).toHaveBeenCalledWith(150, 8000);
    expect(onStarted).toHaveBeenCalledTimes(1);
    expect(onStarted).toHaveBeenCalledWith({ resolvedSampleId: "sth.g03.fire", cueAt: expect.any(Number), durationMs: 2000 });

    await vi.advanceTimersByTimeAsync(2000 + 250);
    expect(onFinished).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
  });

  it("PREPARE 失败时不 COMMIT、不回调 onStarted，仅回报错误", async () => {
    vi.useFakeTimers();
    const host = fakeHost();
    host.prepareSample.mockResolvedValue({ ok: false as const, error: { code: "SAMPLE_UNDEFINED", message: "样本未定义" } });
    const onStarted = vi.fn();
    const onError = vi.fn();
    playComparisonSample(host, { resolvedSampleId: "bh.g03.fire", onStarted, onError });

    await vi.advanceTimersByTimeAsync(0);
    expect(host.commitAfter).not.toHaveBeenCalled();
    expect(onStarted).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith("样本未定义");
  });

  it("stop 清除计时器并下发设备 STOP，随后自动重新 ARM，onFinished 不再触发", async () => {
    vi.useFakeTimers();
    const host = fakeHost(5_000_000);
    const onStarted = vi.fn();
    const onFinished = vi.fn();
    const handle = playComparisonSample(host, { resolvedSampleId: "sth.g08.rain", leadMs: 150, onStarted, onFinished });

    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(150);
    expect(onStarted).toHaveBeenCalledTimes(1);

    handle.stop();
    expect(host.emergencyStop).toHaveBeenCalledWith(3000);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(0);
    expect(host.arm).toHaveBeenCalledWith(7000);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(onFinished).not.toHaveBeenCalled();
  });
});
