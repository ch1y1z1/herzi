import { describe, expect, it } from "vitest";

import { isPaneActive } from "./pane-activity";

describe("isPaneActive", () => {
  it("counts a working agent as active", () => {
    expect(isPaneActive("working")).toBe(true);
  });

  it("counts a blocked agent as active because the turn is not over", () => {
    // `blocked` means the agent is waiting for the user; folding the turn into
    // `Worked for` here is exactly the reported bug.
    expect(isPaneActive("blocked")).toBe(true);
  });

  it("counts every finished or unknown status as inactive", () => {
    for (const status of ["idle", "done", "unknown", "waiting", "error", "down", ""]) {
      expect(isPaneActive(status)).toBe(false);
    }
    expect(isPaneActive(null)).toBe(false);
    expect(isPaneActive(undefined)).toBe(false);
  });
});
