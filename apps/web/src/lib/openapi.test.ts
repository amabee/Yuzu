import { describe, expect, it } from "vitest";
import { fieldsOf, openApiDocument } from "./openapi";
import { apiEndpoints } from "./api-registry";

describe("the OpenAPI document", () => {
  const doc = openApiDocument("https://yuzu.example.test/api/v1");
  it("describes every public endpoint, with bearer auth", () => {
    for (const endpoint of apiEndpoints)
      expect(
        doc.paths[endpoint.path]?.[endpoint.method.toLowerCase()],
        endpoint.path,
      ).toBeTruthy();
    expect(doc.components.securitySchemes.token.scheme).toBe("bearer");
  });
  it("lists a task's fields from its schema", () => {
    const create = apiEndpoints.find(
      (item) => item.path === "/boards/create-task",
    )!;
    const fields = fieldsOf(create.body);
    expect(fields.find((field) => field.name === "name")).toMatchObject({
      required: true,
    });
    expect(fields.map((field) => field.name)).toContain("boardId");
    const state = apiEndpoints.find((item) => item.path === "/boards/state")!;
    expect(fieldsOf(state.query).map((field) => field.name)).toEqual([
      "boardId",
      "query",
    ]);
  });
});
