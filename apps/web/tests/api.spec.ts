import {
  test,
  expect,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import { createRecordId, getDatabase } from "@yuzu/database";
import { startTestCsvWorker, stopTestCsvWorker } from "./csv-worker-process";

process.env.DATABASE_URL = process.env.YUZU_E2E_DATABASE_URL;
const ORIGIN = "http://127.0.0.1:3100";
const MIA_PASSWORD = "mia-member-password-123";

test.beforeAll(() => startTestCsvWorker());
test.afterAll(() => stopTestCsvWorker());
test.beforeEach(async () => {
  if (new URL(process.env.DATABASE_URL!).pathname !== "/yuzu_e2e")
    throw new Error("Refusing to reset a non-test database.");
  const db = getDatabase();
  await db.apiToken.deleteMany();
  await db.auditEvent.deleteMany();
  await db.emailMessage.deleteMany();
  await db.installationSettings.deleteMany();
  await db.accessEvent.deleteMany();
  await db.invitation.deleteMany();
  await db.setupClaim.deleteMany();
  await db.automationRule.deleteMany();
  await db.task.deleteMany();
  await db.board.deleteMany();
  await db.project.deleteMany();
  await db.workspaceMember.deleteMany();
  await db.workspace.deleteMany();
  await db.user.deleteMany();
  await db.verification.deleteMany();
  await db.authenticationAttempt.deleteMany();
});

const post = (page: Page, path: string, data: unknown) =>
  page.request.post(path, { headers: { origin: ORIGIN }, data });

async function team(page: Page) {
  expect(
    (
      await post(page, "/api/v1/setup/owner", {
        name: "Team Owner",
        email: "owner@example.test",
        password: "test-owner-password-123",
        confirmPassword: "test-owner-password-123",
        setupKey: process.env.YUZU_E2E_SETUP_KEY,
      })
    ).status(),
  ).toBe(200);
  const db = getDatabase();
  const owner = await db.user.findUniqueOrThrow({
    where: { email: "owner@example.test" },
  });
  const workspace = await db.workspace.create({
    data: {
      name: "Our team",
      createdById: owner.id,
      members: { create: { userId: owner.id } },
    },
  });
  const seed = await db.board.create({
    data: { name: "Start", workspaceId: workspace.id, createdById: owner.id },
  });
  await db.installationSettings.update({
    where: { id: "installation" },
    data: {
      setupState: "READY",
      initialWorkspaceId: workspace.id,
      initialBoardId: seed.id,
    },
  });
  const made = await post(page, "/api/v1/boards/create-board", {
    workspaceId: workspace.id,
    name: "Launch",
  });
  const memberId = createRecordId();
  const member = await db.user.create({
    data: {
      id: memberId,
      name: "Mia Member",
      email: "mia@example.test",
      emailVerified: true,
      accounts: {
        create: {
          accountId: memberId,
          providerId: "credential",
          password: await (
            await import("better-auth/crypto")
          ).hashPassword(MIA_PASSWORD),
        },
      },
    },
  });
  await db.workspaceMember.create({
    data: { workspaceId: workspace.id, userId: member.id },
  });
  return {
    owner,
    member,
    boardId: (await made.json()).data.id as string,
  };
}

/** A request context with no cookies, like a script. */
async function script(
  token: string,
  playwright: {
    request: { newContext: (options: object) => Promise<APIRequestContext> };
  },
) {
  return playwright.request.newContext({
    baseURL: ORIGIN,
    extraHTTPHeaders: { Authorization: `Bearer ${token}` },
  });
}

test("people create tokens that act as them, within their access", async ({
  page,
  playwright,
}) => {
  test.setTimeout(90_000);
  const { owner, boardId } = await team(page);
  const db = getDatabase();

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/settings/api");
  await page.getByRole("button", { name: "Create token" }).click();
  const form = page.getByRole("dialog");
  await form.getByLabel("Token name").fill("Weekly report script");
  await expect(form.getByRole("radio", { name: "Read only" })).toBeChecked();
  await expect(form.getByRole("radio", { name: "90 days" })).toBeChecked();
  await form.getByRole("button", { name: "Create token" }).click();
  const reveal = page.getByLabel("New API token");
  await expect(reveal).toHaveText(/^yuzu_[A-Za-z0-9_-]{43}$/);
  const readToken = (await reveal.textContent())!;
  await page.screenshot({ path: "../../artifacts/api/created.png" });
  await page.getByRole("button", { name: "Done" }).click();
  const row = page
    .locator(".api-tokens > li")
    .filter({ hasText: "Weekly report script" });
  await expect(row).toContainText("Read only");
  await expect(row).toContainText(readToken.slice(0, 9));
  // Only a fingerprint is stored.
  const stored = await db.apiToken.findFirstOrThrow();
  expect(JSON.stringify(stored)).not.toContain(readToken);

  const reader = await script(readToken, playwright);
  const state = await reader.get(`/api/v1/boards/state?boardId=${boardId}`);
  expect(state.status()).toBe(200);
  expect((await state.json()).data.boardId).toBe(boardId);
  await page.reload();
  await expect(row).toContainText("used now");
  // Read-only tokens can't change anything.
  const refused = await reader.post("/api/v1/boards/create-task", {
    data: { boardId, createKey: crypto.randomUUID(), name: "Nope" },
  });
  expect(refused.status()).toBe(403);
  expect((await refused.json()).error.message).toContain("read-only");
  // Admin, team, settings and token endpoints refuse every token, even
  // with a forged gate header.
  for (const [method, path] of [
    ["GET", "/api/v1/admin/people"],
    ["GET", "/api/v1/tokens/list"],
    ["POST", "/api/v1/tokens/create"],
    ["GET", "/api/v1/team/state"],
    ["POST", "/api/v1/boards/create-board"],
  ] as const) {
    const response = await reader.fetch(path, {
      method,
      headers: { "x-yuzu-api-gate": "write.forged" },
      data: method === "POST" ? {} : undefined,
    });
    expect(response.status(), path).toBe(403);
    expect((await response.json()).error.code).toBe("NOT_AVAILABLE_TO_TOKENS");
  }
  const forged = await reader.post("/api/v1/boards/create-task", {
    headers: { "x-yuzu-api-gate": "write.forged" },
    data: { boardId, createKey: crypto.randomUUID(), name: "Nope" },
  });
  expect(forged.status()).toBe(403);

  // A write token creates tasks as its owner, without an origin header.
  const writeToken = (
    await (
      await post(page, "/api/v1/tokens/create", {
        name: "Zapier sync",
        access: "WRITE",
        expires: "30",
      })
    ).json()
  ).data.token as string;
  const writer = await script(writeToken, playwright);
  const created = await writer.post("/api/v1/boards/create-task", {
    data: { boardId, createKey: crypto.randomUUID(), name: "Ship order 4512" },
  });
  expect(created.status()).toBe(200);
  const task = await db.task.findUniqueOrThrow({
    where: { id: (await created.json()).data.taskId },
  });
  expect(task.createdById).toBe(owner.id);
  expect(
    (
      await writer.post("/api/v1/boards/comment", {
        data: {
          taskId: task.id,
          createKey: crypto.randomUUID(),
          body: "Picked and packed",
        },
      })
    ).status(),
  ).toBe(200);

  // Rate limit: 120 a minute per token.
  await db.authenticationAttempt.update({
    where: { id: `api-token:${stored.id}` },
    data: { count: 120 },
  });
  expect(
    (await reader.get(`/api/v1/boards/state?boardId=${boardId}`)).status(),
  ).toBe(429);

  // Revoked and nonsense tokens stop working.
  await page.reload();
  await page
    .getByRole("button", { name: "Revoke Weekly report script" })
    .click();
  await page.getByRole("button", { name: "Revoke token" }).click();
  await expect(row).toHaveCount(0);
  await db.authenticationAttempt.deleteMany();
  expect(
    (await reader.get(`/api/v1/boards/state?boardId=${boardId}`)).status(),
  ).toBe(401);
  const nonsense = await script("yuzu_not-a-real-token", playwright);
  expect(
    (await nonsense.get(`/api/v1/boards/state?boardId=${boardId}`)).status(),
  ).toBe(401);
  await page.goto("/settings/audit");
  await expect(page.locator(".audit-events")).toContainText(
    "revoked the API token “Weekly report script”",
  );
  await expect(page.locator(".audit-events")).toContainText(
    "created the API token “Zapier sync”",
  );
  await Promise.all([reader.dispose(), writer.dispose(), nonsense.dispose()]);
});

test("tokens follow their owner's access, expire with a warning, and the reference documents them", async ({
  page,
  browser,
  playwright,
}) => {
  test.setTimeout(120_000);
  const { member, boardId } = await team(page);
  const db = getDatabase();
  const mia = await browser.newContext();
  const miaPage = await mia.newPage();
  expect(
    (
      await post(miaPage, "/api/v1/session/sign-in", {
        email: member.email,
        password: MIA_PASSWORD,
      })
    ).status(),
  ).toBe(200);
  const miaToken = (
    await (
      await post(miaPage, "/api/v1/tokens/create", {
        name: "Mia's sync",
        access: "WRITE",
        expires: "never",
      })
    ).json()
  ).data.token as string;
  const miaScript = await script(miaToken, playwright);
  expect(
    (await miaScript.get(`/api/v1/boards/state?boardId=${boardId}`)).status(),
  ).toBe(200);

  // Admins see everyone's tokens.
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/settings/api");
  await page.getByRole("button", { name: "All tokens" }).click();
  await expect(page.locator(".api-tokens")).toContainText("Mia Member");

  // Deactivating Mia revokes her token.
  await post(page, "/api/v1/admin/deactivate", { userId: member.id });
  expect(
    (await miaScript.get(`/api/v1/boards/state?boardId=${boardId}`)).status(),
  ).toBe(401);
  expect(
    (await db.apiToken.findFirstOrThrow({ where: { userId: member.id } }))
      .revokedAt,
  ).not.toBeNull();

  // A week before expiry the owner gets one security email.
  const soon = (
    await (
      await post(page, "/api/v1/tokens/create", {
        name: "Nightly backup",
        access: "READ",
        expires: "30",
      })
    ).json()
  ).data.view.id as string;
  await db.apiToken.update({
    where: { id: soon },
    data: { expiresAt: new Date(Date.now() + 3 * 86_400_000) },
  });
  await expect
    .poll(
      async () =>
        (await db.emailMessage.findFirst({ where: { purpose: "security" } }))
          ?.subject,
      { timeout: 90_000, intervals: [2_000] },
    )
    .toContain("“Nightly backup” expires");
  await page.getByRole("button", { name: "Your tokens" }).click();
  await expect(
    page.locator(".api-tokens > li").filter({ hasText: "Nightly backup" }),
  ).toContainText("Expires in 3 days");

  // The spec and the in-app reference.
  const spec = await (await page.request.get("/api/v1/openapi.json")).json();
  expect(spec.paths["/boards/create-task"].post["x-yuzu-access"]).toBe("write");
  expect(spec.paths["/admin/people"]).toBeUndefined();
  await page.getByRole("button", { name: "Reference" }).click();
  const createTask = page
    .locator(".api-endpoint")
    .filter({ hasText: "/boards/create-task" });
  await createTask.locator("summary").click();
  await expect(createTask).toContainText("createKey");
  await expect(createTask).toContainText("Authorization: Bearer $YUZU_TOKEN");
  await page.screenshot({ path: "../../artifacts/api/reference.png" });
  await miaScript.dispose();
  await mia.close();
});
