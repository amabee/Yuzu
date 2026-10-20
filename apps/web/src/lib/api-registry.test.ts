import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { apiEndpoints, findApiEndpoint } from "./api-registry";

const api = join(__dirname, "../app/api/v1");

describe("the public API registry", () => {
  it("points every endpoint at a real route that handles it", () => {
    for (const endpoint of apiEndpoints) {
      const [first, second] = endpoint.path.slice(1).split("/");
      const exact = join(api, first!, second ?? "", "route.ts");
      const byAction = join(api, first!, "[action]", "route.ts");
      const byId = join(api, first!, "[id]", "route.ts");
      const file = [exact, byId, byAction].find(
        (path) => existsSync(path) && (path !== byId || second === "{id}"),
      );
      expect(file, endpoint.path).toBeTruthy();
      expect(readFileSync(file!, "utf8")).toContain(
        `export async function ${endpoint.method}`,
      );
      if (file === byAction)
        expect(readFileSync(file, "utf8"), endpoint.path).toContain(
          `"${second}"`,
        );
    }
  });

  it("matches requests by method and path, nothing else", () => {
    expect(findApiEndpoint("GET", "/api/v1/boards/state")?.access).toBe("read");
    expect(findApiEndpoint("POST", "/api/v1/boards/update")?.access).toBe(
      "write",
    );
    expect(findApiEndpoint("GET", "/api/v1/attachments/abc-123")).toBeTruthy();
    expect(findApiEndpoint("POST", "/api/v1/boards/state")).toBeUndefined();
    expect(findApiEndpoint("POST", "/api/v1/admin/role")).toBeUndefined();
    expect(
      findApiEndpoint("POST", "/api/v1/boards/create-board"),
    ).toBeUndefined();
    expect(findApiEndpoint("GET", "/api/v1/attachments/a/b")).toBeUndefined();
    expect(findApiEndpoint("GET", "/api/v1/boards/state/x")).toBeUndefined();
  });
});
