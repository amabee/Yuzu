import { describe, it, expect } from "vitest";
import { mergeBoardState } from "./board-cache";
import type { BoardState, BoardTask } from "./board-contract";

describe("board page cache consistency", () => {
  it("publishes a saved focused task to older pages without replacing their membership or totals", () => {
    const old = {
      id: "task",
      revision: 5,
      description: "Before my save",
    } as BoardTask;
    const saved = { ...old, revision: 6, description: "My saved notes" };
    const other = { id: "other", revision: 2 } as BoardTask;
    const pagination = { page: 2, total: 300 } as BoardState["pagination"];
    const current = {
      boardId: "board",
      currentUserId: "me",
      tasks: [old, other],
      focusedTask: old,
      pagination,
      fields: [],
    } as unknown as BoardState;
    const fresh = {
      ...current,
      tasks: [other],
      focusedTask: saved,
      pagination: { page: 1, total: 20 },
      fields: [{ id: "new-field" }],
    } as BoardState;
    const merged = mergeBoardState(current, fresh);
    expect(merged.tasks).toEqual([saved, other]);
    expect(merged.focusedTask).toEqual(saved);
    expect(merged.pagination).toBe(pagination);
    expect(merged.fields).toEqual(fresh.fields);
    expect(current.tasks[0]).toBe(old);
    const newer = { ...saved, revision: 7 };
    expect(
      mergeBoardState({ ...current, tasks: [newer] }, fresh).tasks,
    ).toEqual([newer]);
    expect(
      mergeBoardState({ ...current, currentUserId: "someone-else" }, fresh)
        .tasks[0],
    ).toBe(old);
  });
});
