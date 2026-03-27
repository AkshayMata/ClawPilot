import { describe, it, expect } from "vitest";
import {
  SessionSource,
  NotificationPriority,
  SessionStatus,
} from "./types.js";

describe("shared types", () => {
  describe("SessionSource enum", () => {
    it("has expected values", () => {
      expect(SessionSource.VSCode).toBe("vscode");
      expect(SessionSource.CLI).toBe("cli");
    });

    it("has exactly 2 members", () => {
      const values = Object.values(SessionSource);
      expect(values).toHaveLength(2);
    });
  });

  describe("NotificationPriority enum", () => {
    it("has expected values", () => {
      expect(NotificationPriority.Low).toBe("low");
      expect(NotificationPriority.Normal).toBe("normal");
      expect(NotificationPriority.High).toBe("high");
    });

    it("has exactly 3 members", () => {
      const values = Object.values(NotificationPriority);
      expect(values).toHaveLength(3);
    });
  });

  describe("SessionStatus enum", () => {
    it("has expected values", () => {
      expect(SessionStatus.Active).toBe("active");
      expect(SessionStatus.WaitingForInput).toBe("waiting_for_input");
      expect(SessionStatus.Completed).toBe("completed");
      expect(SessionStatus.Error).toBe("error");
    });

    it("has exactly 4 members", () => {
      const values = Object.values(SessionStatus);
      expect(values).toHaveLength(4);
    });
  });
});
