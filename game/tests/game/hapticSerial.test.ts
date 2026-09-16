import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  encodeVoltageCommand,
  HapticSerialManager,
  HAPTIC_EVENT_BYTES,
  sampleKeyToEventByte,
  SERIAL_BAUD_RATE
} from "../../app/game/hapticSerial";
import { SerialSettingsPage } from "../../app/components/SerialSettingsPage";
import { StudyEntry } from "../../app/components/StudyEntry";

describe("haptic serial (legacy diagnostic protocol)", () => {
  it("uses a fixed non-1200 baud rate", () => {
    expect(SERIAL_BAUD_RATE).toBe(115200);
    expect(SERIAL_BAUD_RATE).not.toBe(1200);
  });

  it("maps game haptic sample keys to single-byte event notifications", () => {
    expect(sampleKeyToEventByte("mechanism-unlock")).toBe(0x01);
    expect(sampleKeyToEventByte("landing-rubble")).toBe(0x02);
    expect(sampleKeyToEventByte("fire-burn")).toBe(0x03);
    expect(sampleKeyToEventByte("ghost-pass")).toBe(0x04);
    expect(sampleKeyToEventByte("chest-cue")).toBe(0x05);
    expect(sampleKeyToEventByte("ridge-unlock")).toBe(0x06);
    expect(sampleKeyToEventByte("projectile-pass")).toBe(0x07);
    expect(sampleKeyToEventByte("danger-area-expand")).toBe(0x08);
    expect(sampleKeyToEventByte("rain")).toBe(0x09);
    expect(sampleKeyToEventByte("fireworks")).toBe(0x0a);
    expect(sampleKeyToEventByte("spatiotemporal")).toBe(0x0b);
    expect(sampleKeyToEventByte("none")).toBeUndefined();
    expect(sampleKeyToEventByte("unknown-key")).toBeUndefined();
  });

  it("encodes the voltage setting frame with clamping", () => {
    expect([...encodeVoltageCommand(100)]).toEqual([0xa5, 0x01, 100]);
    expect([...encodeVoltageCommand(300)]).toEqual([0xa5, 0x01, 255]);
    expect([...encodeVoltageCommand(-5)]).toEqual([0xa5, 0x01, 0]);
  });

  it("sends single-byte events and stops only through the connected writer", async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    const port = {
      open: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
      getInfo: () => ({}),
      writable: { getWriter: () => ({ write }) }
    };
    const manager = new HapticSerialManager();
    await manager.connect(port as never);

    await manager.sendEventByte(HAPTIC_EVENT_BYTES["fireworks"]);
    expect(write).toHaveBeenLastCalledWith(new Uint8Array([0x0a]));

    await manager.setVoltage(77);
    expect(write).toHaveBeenLastCalledWith(new Uint8Array([0xa5, 0x01, 77]));

    await manager.stop();
    expect(write).toHaveBeenLastCalledWith(new Uint8Array([0x00]));

    await manager.disconnect();
    expect(manager.isConnected()).toBe(false);
  });

  it("dispatches game samples only when connected and explicitly enabled", async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    const port = {
      open: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
      getInfo: () => ({}),
      writable: { getWriter: () => ({ write }) }
    };
    const manager = new HapticSerialManager();

    // Connected but not enabled: nothing is written.
    await manager.connect(port as never);
    await manager.dispatchSample("chest-cue");
    expect(write).not.toHaveBeenCalled();

    // Enabled: the mapped event byte is written.
    manager.enabled = true;
    await manager.dispatchSample("chest-cue");
    expect(write).toHaveBeenCalledWith(new Uint8Array([0x05]));

    // Unmapped samples stay silent.
    await manager.dispatchSample("none");
    expect(write).toHaveBeenCalledTimes(1);
  });

  it("does not block gameplay when the writer fails", async () => {
    const manager = new HapticSerialManager();
    manager.enabled = true;
    // No port connected: dispatchSample must resolve silently.
    await expect(manager.dispatchSample("fireworks")).resolves.toBeUndefined();
  });
});

describe("serial settings entry", () => {
  it("routes the global serial settings page standalone", () => {
    const html = renderToStaticMarkup(
      createElement(StudyEntry, { searchOverride: "?mode=serial" })
    );
    expect(html).toContain("串口设置");
  });

  it("shows a bounded unsupported-browser notice outside a Web Serial context", () => {
    const html = renderToStaticMarkup(createElement(SerialSettingsPage));
    expect(html).toContain("当前浏览器不支持 Web Serial");
    expect(html).toContain("localhost");
  });
});
