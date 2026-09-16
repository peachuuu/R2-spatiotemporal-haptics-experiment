import "@testing-library/jest-dom/vitest";
import "fake-indexeddb/auto";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// React Testing Library needs explicit cleanup when vitest globals are off.
afterEach(() => {
  cleanup();
});
