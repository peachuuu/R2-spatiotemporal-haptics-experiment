import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { HardwareHostFrame } from "../../src/integration/HardwareHostFrame";

describe("HardwareHostFrame", () => {
  it("keeps the serial-host iframe mounted while its dock is collapsed", () => {
    render(
      <HardwareHostFrame sessionId="session-serial">
        <div>study</div>
      </HardwareHostFrame>
    );

    expect(screen.getByTestId("hardware-host-frame")).toHaveAttribute("hidden");
  });

  it("delegates Web Serial permission to the cross-origin hardware-host iframe", () => {
    render(
      <HardwareHostFrame sessionId="session-serial">
        <div>study</div>
      </HardwareHostFrame>
    );

    fireEvent.click(screen.getByRole("button", { name: /硬件连接/ }));

    expect(screen.getByTestId("hardware-host-frame")).toHaveAttribute("allow", "serial");
  });
});
