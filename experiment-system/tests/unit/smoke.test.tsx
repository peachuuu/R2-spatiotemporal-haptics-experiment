import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import App from "../../src/app/App";

describe("App smoke", () => {
  it("renders the study workflow heading", () => {
    render(<App />);
    expect(screen.getByRole("heading", { name: /电触觉游戏实验/ })).toBeInTheDocument();
  });
});
