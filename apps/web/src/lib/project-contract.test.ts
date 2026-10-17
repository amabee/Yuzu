import { describe, expect, it } from "vitest";
import {
  moveBoardSchema,
  projectCreateSchema,
  projectInviteSchema,
  projectMemberSchema,
  projectUpdateSchema,
} from "./project-contract";

const id = "0192f5a4-7c3e-7b4a-9c1d-2e3f4a5b6c7d";

describe("project contract", () => {
  it("accepts a valid project and trims its name", () => {
    expect(
      projectCreateSchema.parse({
        workspaceId: id,
        name: "  Yuzu 1.0 ",
        color: "teal",
        visibility: "PRIVATE",
      }).name,
    ).toBe("Yuzu 1.0");
  });

  it("rejects raw colors, unknown visibility and empty names", () => {
    const base = {
      workspaceId: id,
      name: "A",
      color: "teal",
      visibility: "PUBLIC",
    };
    expect(
      projectCreateSchema.safeParse({ ...base, color: "#ff0000" }).success,
    ).toBe(false);
    expect(
      projectCreateSchema.safeParse({ ...base, visibility: "SECRET" }).success,
    ).toBe(false);
    expect(
      projectCreateSchema.safeParse({ ...base, name: "   " }).success,
    ).toBe(false);
    expect(
      projectCreateSchema.safeParse({ ...base, extra: true }).success,
    ).toBe(false);
  });

  it("requires an actual change and a revision when updating", () => {
    expect(
      projectUpdateSchema.safeParse({ projectId: id, revision: 1 }).success,
    ).toBe(false);
    expect(
      projectUpdateSchema.safeParse({ projectId: id, name: "B" }).success,
    ).toBe(false);
    expect(
      projectUpdateSchema.safeParse({
        projectId: id,
        revision: 1,
        visibility: "PUBLIC",
      }).success,
    ).toBe(true);
  });

  it("only gives roles when adding or changing a member", () => {
    expect(
      projectMemberSchema.safeParse({
        action: "remove",
        projectId: id,
        userId: "u",
        role: "MEMBER",
      }).success,
    ).toBe(false);
    expect(
      projectMemberSchema.safeParse({
        action: "add",
        projectId: id,
        userId: "u",
      }).success,
    ).toBe(false);
  });

  it("normalizes invitation emails", () => {
    expect(
      projectInviteSchema.parse({
        projectId: id,
        email: "Client@Example.TEST",
        role: "MEMBER",
      }).email,
    ).toBe("client@example.test");
  });

  it("allows moving a board out to standalone with a null project", () => {
    expect(
      moveBoardSchema.parse({ boardId: id, projectId: null }).projectId,
    ).toBeNull();
  });
});
