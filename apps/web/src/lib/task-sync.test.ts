import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "./api-client";
import {
  editTaskDraft,
  reconcileTaskDraft,
  saveTaskUpdate,
  taskDraft,
} from "./task-sync";
import type { BoardTask } from "./board-contract";
const boardId = "019aa1c0-1111-7111-8111-111111111111";
const fieldId = "019aa1c0-2222-7222-8222-222222222222";
const task: BoardTask = {
  id: "019aa1c0-3333-7333-8333-333333333333",
  name: "Build",
  description: "Original",
  checklist: [],
  statusId: "todo",
  priority: "NORMAL",
  startDate: null,
  dueDate: null,
  groupId: null,
  assigneeIds: ["member-a", "member-b"],
  fieldValues: { [fieldId]: "original" },
  createdById: "member-a",
  createdByName: "A",
  revision: 1,
  archivedAt: null,
  editorIds: [],
  canEdit: true,
  activity: [],
  commentCount: 0,
};
const original = taskDraft(task);
afterEach(() => vi.unstubAllGlobals());
describe("collaborative task drafts", () => {
  it("starts subsequent scalar and custom-field edits from their accepted saved values", () => {
    const saved = {
      ...original,
      name: "Saved name",
      fieldValues: { [fieldId]: "saved" },
    };
    const edited = editTaskDraft(original, saved, saved, {
      name: "Next name",
      fieldValues: { [fieldId]: "next" },
    });
    const result = reconcileTaskDraft(edited.baseline, edited.local, saved);
    expect(result.conflicts).toEqual([]);
    expect(result.changes).toEqual({
      name: "Next name",
      fieldValues: { [fieldId]: "next" },
    });
  });

  it("merges independent edits but rejects overlapping checklist changes", () => {
    const checklist = [{ id: fieldId, text: "Review", done: false }];
    const base = { ...original, checklist };
    const local = { ...base, checklist: [{ ...checklist[0]!, done: true }] };
    const independent = reconcileTaskDraft(base, local, {
      ...base,
      description: "Remote notes",
    });
    expect(independent.conflicts).toEqual([]);
    expect(independent.draft.description).toBe("Remote notes");
    expect(independent.changes.checklist?.[0]?.done).toBe(true);
    expect(
      reconcileTaskDraft(base, local, {
        ...base,
        checklist: [{ ...checklist[0]!, text: "New label" }],
      }).conflicts,
    ).toEqual(["checklist"]);
  });
  it("starts a new edit from the visible remote version while retaining existing dirty baselines", () => {
    const latest = {
      ...original,
      description: "Remote notes",
      statusId: "progress",
    };
    const edited = editTaskDraft(original, original, latest, {
      description: "Edit to remote notes",
    });
    expect(
      reconcileTaskDraft(edited.baseline, edited.local, latest).conflicts,
    ).toEqual([]);
    const alreadyDirty = editTaskDraft(
      original,
      { ...original, description: "Unsaved notes" },
      latest,
      { description: "More unsaved notes" },
    );
    expect(
      reconcileTaskDraft(alreadyDirty.baseline, alreadyDirty.local, latest)
        .conflicts,
    ).toEqual(["description"]);
  });

  it("preserves a local description and adopts a remote status, submitting only the description", () => {
    const result = reconcileTaskDraft(
      original,
      { ...original, description: "Mine" },
      { ...original, statusId: "progress" },
    );
    expect(result.draft.statusId).toBe("progress");
    expect(result.draft.description).toBe("Mine");
    expect(result.changes).toEqual({ description: "Mine" });
    expect(result.conflicts).toEqual([]);
  });
  it("detects overlapping edits without losing either the draft or latest fields", () => {
    const result = reconcileTaskDraft(
      original,
      { ...original, description: "Mine" },
      { ...original, description: "Theirs", priority: "HIGH" },
    );
    expect(result.conflicts).toEqual(["description"]);
    expect(result.draft).toMatchObject({
      description: "Mine",
      priority: "HIGH",
    });
  });
  it("merges independent custom fields and treats reordered selections as unchanged", () => {
    const result = reconcileTaskDraft(
      original,
      {
        ...original,
        assigneeIds: ["member-b", "member-a"],
        fieldValues: { [fieldId]: "mine" },
      },
      { ...original, fieldValues: { [fieldId]: "original", other: "theirs" } },
    );
    expect(result.changes).toEqual({ fieldValues: { [fieldId]: "mine" } });
    expect(result.draft.fieldValues).toEqual({
      [fieldId]: "mine",
      other: "theirs",
    });
    expect(result.conflicts).toEqual([]);
  });
  it("does not resubmit values another editor already saved", () => {
    const local = { ...original, description: "Same" };
    expect(reconcileTaskDraft(original, local, local).changes).toEqual({});
  });
});
const response = (data: unknown, status = 200) =>
  new Response(
    JSON.stringify(
      status === 200
        ? { data, requestId: "test" }
        : {
            error: { code: "TASK_CHANGED", message: "Stale task" },
            requestId: "test",
          },
    ),
    { status, headers: { "Content-Type": "application/json" } },
  );
const state = (latest: BoardTask) => ({
  boardId,
  currentUserId: "member-a",
  canManage: false,
  canManageManagers: false,
  managerIds: [],
  groups: [],
  fields: [],
  people: [],
  tasks: [latest],
  approvalPolicy: {
    version: 0,
    enabled: false,
    requireCreation: false,
    requireChanges: true,
    requireArchive: false,
    protectedFieldIds: [],
    primaryApproverId: null,
    backupApproverId: null,
  },
  pendingApprovals: [],
});
describe("concurrent save recovery", () => {
  it("retries a race once with the latest revision, preserving unrelated edits", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(response(null, 409))
      .mockResolvedValueOnce(
        response(state({ ...task, statusId: "progress", revision: 2 })),
      )
      .mockResolvedValueOnce(response({ taskId: task.id, revision: 3 }));
    vi.stubGlobal("fetch", fetch);
    await saveTaskUpdate(
      boardId,
      { taskId: task.id, revision: 1, changes: { description: "Mine" } },
      task,
    );
    expect(JSON.parse(fetch.mock.calls[2]![1].body)).toMatchObject({
      taskId: task.id,
      revision: 2,
      changes: { description: "Mine" },
    });
  });
  it("never retries an overlapping edit or overwrites a teammate", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(response(null, 409))
      .mockResolvedValueOnce(
        response(state({ ...task, description: "Theirs", revision: 2 })),
      );
    vi.stubGlobal("fetch", fetch);
    await expect(
      saveTaskUpdate(
        boardId,
        { taskId: task.id, revision: 1, changes: { description: "Mine" } },
        task,
      ),
    ).rejects.toMatchObject({ code: "TASK_CHANGED" });
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("does not retry permission failures or archived tasks", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          error: { code: "FORBIDDEN", message: "No access" },
        }),
        { status: 403 },
      ),
    );
    vi.stubGlobal("fetch", fetch);
    await expect(
      saveTaskUpdate(
        boardId,
        { taskId: task.id, revision: 1, changes: { description: "Mine" } },
        task,
      ),
    ).rejects.toBeInstanceOf(ApiError);
    expect(fetch).toHaveBeenCalledTimes(1);
    fetch.mockResolvedValueOnce(response(null, 409)).mockResolvedValueOnce(
      response(
        state({
          ...task,
          archivedAt: "2026-10-14T00:00:00Z",
          canEdit: false,
          revision: 2,
        }),
      ),
    );
    await expect(
      saveTaskUpdate(
        boardId,
        { taskId: task.id, revision: 1, changes: { description: "Mine" } },
        task,
      ),
    ).rejects.toMatchObject({ code: "TASK_CHANGED" });
    expect(fetch).toHaveBeenCalledTimes(3);
  });
});
