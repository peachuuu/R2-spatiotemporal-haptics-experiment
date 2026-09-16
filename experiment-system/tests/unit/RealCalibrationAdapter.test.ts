import { describe, expect, it, vi } from "vitest";
import { RealCalibrationAdapter, UnavailableCalibrationAdapter } from "../../src/adapters/RealCalibrationAdapter";
import { CALIBRATION_HARDWARE_MAP } from "../../src/domain/calibrationHardwareMap";
import type { HardwareHostClient } from "../../src/integration/hardwareHostClient";

function fakeHost(overrides: Partial<Record<"stop" | "setCal" | "startCal", "ok" | "fail">> = {}) {
  const host = {
    emergencyStop: vi.fn(async () => (overrides.stop === "fail" ? { ok: false, error: { code: "TIMEOUT", message: "stop timeout" } } : { ok: true, value: { kind: "STOPPED" } })),
    setCalibration: vi.fn(async (_region: number, code: number) =>
      overrides.setCal === "fail" ? { ok: false, error: { code: "DEVICE_ERROR", deviceError: 0x08, deviceErrorName: "INVALID_OUTPUT", message: "INVALID_OUTPUT" } } : { ok: true, value: { regionIndex: 0, voltageCode: code } }
    ),
    startCalibration: vi.fn(async () => (overrides.startCal === "fail" ? { ok: false, error: { code: "TIMEOUT", message: "start timeout" } } : { ok: true, value: { regionIndex: 0 } })),
    arm: vi.fn(async () => ({ ok: true, value: undefined })),
    getStatus: vi.fn(async () => ({ ok: true, value: { state: 2, armed: true, voltageCode: 0, preparedSample: null, fault: 0 } })),
    hello: vi.fn(),
    onDeviceEvent: vi.fn(),
    onStatusChanged: vi.fn(),
    attach: vi.fn(),
    detach: vi.fn(),
    prepareSample: vi.fn(),
    commitAfter: vi.fn()
  } as unknown as HardwareHostClient;
  return host;
}

describe("RealCalibrationAdapter", () => {
  it("applies output levels via STOP -> ARM -> SET_CALIBRATION with hardware acknowledgement", async () => {
    const host = fakeHost();
    const adapter = new RealCalibrationAdapter(host);
    const status = await adapter.applyVoltage({ fingerId: "left-thumb-index", voltageCode: 120 });
    expect(status.state).toBe("ready");
    expect(host.emergencyStop).toHaveBeenCalledTimes(1);
    expect(host.arm).toHaveBeenCalledTimes(1);
    expect(host.arm).toHaveBeenCalledWith(7000);
    expect(host.setCalibration).toHaveBeenCalledWith(1, 120, 7000);
    expect(status.detail).toContain("左手拇指食指");
  });

  it("applies levels in-place without STOP or re-ARM", async () => {
    const host = fakeHost();
    vi.mocked(host.getStatus).mockResolvedValue({ ok: true, value: { state: 1, armed: true, voltageCode: 100, preparedSample: null, fault: 0 } });
    const adapter = new RealCalibrationAdapter(host);
    const status = await adapter.applyVoltageInPlace({ fingerId: "left-thumb-index", voltageCode: 120 });
    expect(status.state).toBe("ready");
    expect(host.emergencyStop).not.toHaveBeenCalled();
    expect(host.arm).not.toHaveBeenCalled();
    expect(host.setCalibration).toHaveBeenCalledWith(1, 120, 7000);
  });

  it("refuses in-place apply while the device is playing and touches nothing", async () => {
    const host = fakeHost();
    vi.mocked(host.getStatus).mockResolvedValue({ ok: true, value: { state: 5, armed: true, voltageCode: 100, preparedSample: null, fault: 0 } });
    const adapter = new RealCalibrationAdapter(host);
    const status = await adapter.applyVoltageInPlace({ fingerId: "left-palm", voltageCode: 120 });
    expect(status.state).toBe("error");
    expect(status.detail).toContain("设备正在播放");
    expect(host.setCalibration).not.toHaveBeenCalled();
    expect(host.emergencyStop).not.toHaveBeenCalled();
  });

  it("stops an in-place pulse preview and re-arms for the game", async () => {
    const host = fakeHost();
    const adapter = new RealCalibrationAdapter(host);
    const status = await adapter.stopStimulationInPlace({ fingerId: "left-palm" });
    expect(status.state).toBe("ready");
    expect(host.emergencyStop).toHaveBeenCalledTimes(1);
    expect(host.arm).toHaveBeenCalledWith(7000);
  });

  it("keeps all eight UI regions aligned to the upper-computer output channels", () => {
    expect(CALIBRATION_HARDWARE_MAP["left-palm"].outputChannel).toBe(0);
    expect(CALIBRATION_HARDWARE_MAP["left-thumb-index"].outputChannel).toBe(1);
    expect(CALIBRATION_HARDWARE_MAP["left-middle-ring"].outputChannel).toBe(2);
    expect(CALIBRATION_HARDWARE_MAP["left-little"].outputChannel).toBe(3);
    expect(CALIBRATION_HARDWARE_MAP["right-palm"].outputChannel).toBe(4);
    expect(CALIBRATION_HARDWARE_MAP["right-thumb-index"].outputChannel).toBe(5);
    expect(CALIBRATION_HARDWARE_MAP["right-middle-ring"].outputChannel).toBe(6);
    expect(CALIBRATION_HARDWARE_MAP["right-little"].outputChannel).toBe(7);
  });

  it("surfaces the stop failure before applying anything", async () => {
    const host = fakeHost({ stop: "fail" });
    const adapter = new RealCalibrationAdapter(host);
    const status = await adapter.applyVoltage({ fingerId: "left-palm", voltageCode: 80 });
    expect(status.state).toBe("error");
    expect(status.detail).toContain("停止当前输出失败");
    expect(host.setCalibration).not.toHaveBeenCalled();
  });

  it("surfaces device-level apply failures as retryable errors", async () => {
    const host = fakeHost({ setCal: "fail" });
    const adapter = new RealCalibrationAdapter(host);
    const status = await adapter.applyVoltage({ fingerId: "left-palm", voltageCode: 300 });
    // 300 超出 0-255：本地校验先行拒绝
    expect(status.state).toBe("error");
    const okStatus = await adapter.applyVoltage({ fingerId: "left-palm", voltageCode: 120 });
    expect(okStatus.state).toBe("error");
    expect(okStatus.detail).toContain("INVALID_OUTPUT");
  });

  it("starts calibration pulses after applying and stops via STOP", async () => {
    const host = fakeHost();
    const adapter = new RealCalibrationAdapter(host);
    const started = await adapter.startStimulation({ fingerId: "right-little", voltageCode: 90 });
    expect(started.state).toBe("ready");
    expect(host.startCalibration).toHaveBeenCalledWith(7, 7000);
    const stopped = await adapter.stopStimulation({ fingerId: "right-little" });
    expect(stopped.state).toBe("ready");
  });

  it("re-arms a safely stopped device before handing it to the game", async () => {
    const host = fakeHost();
    vi.mocked(host.getStatus).mockResolvedValue({ ok: true, value: { state: 1, armed: false, voltageCode: 0, preparedSample: null, fault: 0 } });
    const adapter = new RealCalibrationAdapter(host);
    const status = await adapter.finishCalibration();
    expect(status.state).toBe("ready");
    expect(host.arm).toHaveBeenCalledTimes(1);
  });

  it("keeps the unavailable adapter explicit in production without a host", async () => {
    const adapter = new UnavailableCalibrationAdapter();
    expect((await adapter.getStatus()).state).toBe("unavailable");
    expect((await adapter.applyVoltage()).state).toBe("unavailable");
    expect((await adapter.applyVoltageInPlace()).state).toBe("unavailable");
    expect((await adapter.startStimulation()).state).toBe("unavailable");
    expect((await adapter.startStimulationInPlace()).state).toBe("unavailable");
    expect((await adapter.stopStimulation()).state).toBe("unavailable");
    expect((await adapter.stopStimulationInPlace()).state).toBe("unavailable");
  });
});
