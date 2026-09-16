import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CalibrationGrid } from "../../src/components/CalibrationGrid";
import type { DeviceStatus } from "../../src/adapters/contracts";

const ready = (): DeviceStatus => ({ state: "ready" });

describe("CalibrationGrid", () => {
  it("does not STOP an active calibration pulse when parent callbacks are refreshed", async () => {
    const apply = vi.fn(async () => ready());
    const start = vi.fn(async () => ready());
    const stop = vi.fn(async () => ready());
    const keepAlive = vi.fn(async () => ready());
    const props = () => ({
      initialRecords: [],
      onApplyVoltage: (...args: Parameters<typeof apply>) => apply(...args),
      onStartStimulation: (...args: Parameters<typeof start>) => start(...args),
      onStopStimulation: (...args: Parameters<typeof stop>) => stop(...args),
      onKeepAlive: () => keepAlive(),
      onValidSubmit: vi.fn()
    });
    const view = render(<CalibrationGrid {...props()} />);

    const firstRow = screen.getAllByTestId("calibration-row")[0]!;
    fireEvent.change(within(firstRow).getByRole("spinbutton"), { target: { value: "100" } });
    fireEvent.click(within(firstRow).getByRole("button", { name: "确定" }));
    await waitFor(() => expect(apply).toHaveBeenCalledTimes(1));
    fireEvent.click(within(firstRow).getByRole("button", { name: "开始校准" }));
    await waitFor(() => expect(start).toHaveBeenCalledTimes(1));
    expect(within(firstRow).getByRole("button", { name: "停止校准" })).toBeTruthy();

    // CalibrationScreen writes its event log after START, which refreshes callback identities.
    view.rerender(<CalibrationGrid {...props()} />);
    expect(stop).not.toHaveBeenCalled();
  });

  it("stops an active calibration and confirms ARM before continuing to the game", async () => {
    const start = vi.fn(async () => ready());
    const stop = vi.fn(async () => ready());
    const ensureArmed = vi.fn(async () => ready());
    const submitted = vi.fn();
    const initialRecords = ([
      "left-palm", "left-thumb-index", "left-middle-ring", "left-little",
      "right-palm", "right-thumb-index", "right-middle-ring", "right-little"
    ] as const).map(fingerId => ({ fingerId, thresholdVoltage: 100, selectedVoltage: 100, mockTrialOutcome: "not-run" as const, recordedAt: "2026-08-28T00:00:00.000Z" }));
    render(
      <CalibrationGrid
        initialRecords={initialRecords}
        onApplyVoltage={async () => ready()}
        onStartStimulation={start}
        onStopStimulation={stop}
        onKeepAlive={async () => ready()}
        onEnsureArmed={ensureArmed}
        onValidSubmit={submitted}
      />
    );

    const firstRow = screen.getAllByTestId("calibration-row")[0]!;
    fireEvent.click(within(firstRow).getByRole("button", { name: "开始校准" }));
    await waitFor(() => expect(start).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: "继续" }));

    await waitFor(() => expect(stop).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(ensureArmed).toHaveBeenCalledTimes(1));
    expect(submitted).toHaveBeenCalledTimes(1);
  });
});
