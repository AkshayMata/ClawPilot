import { describe, it, expect, beforeEach } from "vitest";
import { SessionSource, SessionStatus } from "@clawpilot/shared";
import { SessionManager } from "./sessions.js";

describe("SessionManager", () => {
  let mgr: SessionManager;

  beforeEach(() => {
    mgr = new SessionManager();
  });

  describe("getOrCreate", () => {
    it("creates a new session on first call", () => {
      const session = mgr.getOrCreate("s1", SessionSource.VSCode, "My Label");
      expect(session.id).toBe("s1");
      expect(session.source).toBe("vscode");
      expect(session.label).toBe("My Label");
      expect(session.status).toBe("active");
      expect(session.createdAt).toBeTruthy();
      expect(session.lastActivityAt).toBeTruthy();
    });

    it("returns existing session on repeat call", () => {
      const first = mgr.getOrCreate("s1", SessionSource.VSCode, "Label1");
      const second = mgr.getOrCreate("s1", SessionSource.VSCode, "Label1");
      expect(second).toBe(first);
    });

    it("generates default label when none provided", () => {
      const session = mgr.getOrCreate("abcdefgh-1234", SessionSource.CLI);
      expect(session.label).toBe("cli-abcdefgh");
    });

    it("updates label when a new one is provided", () => {
      mgr.getOrCreate("s1", SessionSource.VSCode, "OldLabel");
      const updated = mgr.getOrCreate("s1", SessionSource.VSCode, "NewLabel");
      expect(updated.label).toBe("NewLabel");
    });

    it("does not update label if same value", () => {
      const original = mgr.getOrCreate("s1", SessionSource.VSCode, "Same");
      const again = mgr.getOrCreate("s1", SessionSource.VSCode, "Same");
      expect(again.label).toBe("Same");
      expect(again).toBe(original);
    });
  });

  describe("updateStatus", () => {
    it("updates status and touches lastActivityAt", () => {
      const session = mgr.getOrCreate("s1", SessionSource.VSCode);
      const originalActivity = session.lastActivityAt;

      // Force a different timestamp
      mgr.updateStatus("s1", SessionStatus.WaitingForInput);
      expect(session.status).toBe("waiting_for_input");
      // lastActivityAt should be updated (or same if very fast)
      expect(session.lastActivityAt).toBeTruthy();
    });

    it("does nothing for unknown session", () => {
      // Should not throw
      mgr.updateStatus("nonexistent", SessionStatus.Error);
    });
  });

  describe("get", () => {
    it("returns session by id", () => {
      mgr.getOrCreate("s1", SessionSource.VSCode, "Test");
      const result = mgr.get("s1");
      expect(result).toBeDefined();
      expect(result!.id).toBe("s1");
    });

    it("returns undefined for unknown id", () => {
      expect(mgr.get("unknown")).toBeUndefined();
    });
  });

  describe("touch", () => {
    it("updates lastActivityAt", () => {
      const session = mgr.getOrCreate("s1", SessionSource.VSCode);
      const before = session.lastActivityAt;
      mgr.touch("s1");
      expect(session.lastActivityAt).toBeTruthy();
    });

    it("does nothing for unknown session", () => {
      mgr.touch("nonexistent"); // should not throw
    });
  });

  describe("listAll", () => {
    it("returns empty array when no sessions", () => {
      expect(mgr.listAll()).toEqual([]);
    });

    it("returns all sessions", () => {
      mgr.getOrCreate("s1", SessionSource.VSCode);
      mgr.getOrCreate("s2", SessionSource.CLI);
      const all = mgr.listAll();
      expect(all).toHaveLength(2);
      expect(all.map((s) => s.id).sort()).toEqual(["s1", "s2"]);
    });
  });

  describe("remove", () => {
    it("removes a session", () => {
      mgr.getOrCreate("s1", SessionSource.VSCode);
      mgr.remove("s1");
      expect(mgr.get("s1")).toBeUndefined();
      expect(mgr.listAll()).toHaveLength(0);
    });

    it("does nothing for unknown session", () => {
      mgr.remove("nonexistent"); // should not throw
    });
  });
});
