import { test, expect, type Page } from "@playwright/test";
import { createRecordId, getDatabase } from "@yuzu/database";
process.env.DATABASE_URL = process.env.YUZU_E2E_DATABASE_URL;
const ORIGIN = "http://127.0.0.1:3100";
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
const ok = async (response: Awaited<ReturnType<typeof post>>) => {
  expect(response.status(), await response.text()).toBe(200);
  return (await response.json()).data;
};

async function setup(page: Page) {
  await ok(
    await post(page, "/api/v1/setup/owner", {
      name: "Team Owner",
      email: "owner@example.test",
      password: "test-owner-password-123",
      confirmPassword: "test-owner-password-123",
      setupKey: process.env.YUZU_E2E_SETUP_KEY,
    }),
  );
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
  const board = (
    await ok(
      await post(page, "/api/v1/boards/create-board", {
        workspaceId: workspace.id,
        name: "Launch",
      }),
    )
  ).id as string;
  return { owner, workspace, board };
}

test("Work and CRM have separate navigation with shared access and responsive controls", async ({
  page,
  browser,
}) => {
  test.setTimeout(process.env.YUZU_E2E_DEV === "1" ? 120_000 : 45_000);
  const navigationTimeout = process.env.YUZU_E2E_DEV === "1" ? 30_000 : 10_000;
  const { board } = await setup(page);
  await page.goto(`/boards/${board}`);
  const modules = page.getByRole("navigation", {
    name: "Modules",
    exact: true,
  });
  await expect(
    modules.getByRole("link", { name: "Work", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  await modules.getByRole("link", { name: "CRM", exact: true }).click();
  await expect(page).toHaveURL(/\/crm$/, { timeout: navigationTimeout });
  await expect(
    page.getByRole("heading", { name: "Customer relationships" }),
  ).toBeVisible();
  await expect(
    modules.getByRole("link", { name: "CRM", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  await expect(
    page.getByRole("navigation", { name: "Workspace boards" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "Settings", exact: true }).first(),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Approvals", exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Customer relationships" }),
  ).toBeVisible();
  await expect(page.locator(".shell-module-rail")).toBeVisible();
  await expect(page.locator(".shell-context-search")).toBeVisible();
  await page
    .getByRole("button", { name: "Switch module, current module CRM" })
    .click();
  await expect(
    page.getByRole("menuitem", { name: /Work Projects and tasks/ }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await page.locator(".shell-context-search").click();
  const command = page.getByRole("dialog", { name: "Search your workspace" });
  const commandInput = command.getByRole("combobox", {
    name: "Search workspace records",
  });
  await expect(commandInput).toBeFocused();
  await expect(command.locator(".command-leaf")).toBeVisible();
  await expect(command.locator(".command-lemon")).toBeVisible();
  await page.screenshot({ path: "../../artifacts/modules/command-light.png" });

  await expect(
    page.getByRole("dialog", { name: "Search your workspace" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await page.screenshot({ path: "../../artifacts/modules/crm-desktop.png" });
  await page.getByRole("switch", { name: "Dark mode", exact: true }).click();
  await expect(
    page.getByRole("switch", { name: "Dark mode", exact: true }),
  ).toBeChecked();
  await expect(
    page.getByRole("switch", { name: "Dark mode", exact: true }),
  ).toHaveAttribute("aria-disabled", "false");
  await page.screenshot({ path: "../../artifacts/modules/sidebar-dark.png" });
  await page.keyboard.press("Control+k");
  await expect(
    page.getByRole("dialog", { name: "Search your workspace" }),
  ).toBeVisible();
  await page.screenshot({ path: "../../artifacts/modules/command-dark.png" });
  await page.keyboard.press("Escape");
  await page.getByRole("switch", { name: "Dark mode", exact: true }).click();
  await expect(
    page.getByRole("switch", { name: "Dark mode", exact: true }),
  ).not.toBeChecked();
  await expect(
    page.getByRole("switch", { name: "Dark mode", exact: true }),
  ).toHaveAttribute("aria-disabled", "false");
  await page.getByRole("button", { name: "Toggle navigation" }).click();
  await expect(page.locator(".shell-context-panel")).toBeHidden();
  await expect(
    modules.getByRole("link", { name: "CRM", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /^Account menu/ }),
  ).toBeVisible();
  await page.keyboard.press("Control+k");
  await expect(
    page.getByRole("dialog", { name: "Search your workspace" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Toggle navigation" }).click();
  await expect(page.locator(".shell-context-panel")).toBeVisible();
  await page.getByRole("link", { name: "Open Work boards" }).click();
  await expect(page).toHaveURL(/\/boards$/, { timeout: navigationTimeout });
  await expect(
    page.getByRole("navigation", { name: "Workspace boards" }),
  ).toBeVisible();
  expect(
    await getDatabase().board.count({ where: { id: board, name: "Launch" } }),
  ).toBe(1);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Toggle navigation" }).click();
  await page
    .getByRole("button", { name: "Search workspace", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Search your workspace" }),
  ).toBeVisible();
  await expect(
    page.getByRole("dialog", { name: "Sidebar", exact: true }),
  ).toHaveCount(0);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Toggle navigation" }).click();
  await page.screenshot({ path: "../../artifacts/modules/sidebar-mobile.png" });
  await page
    .getByRole("navigation", { name: "Modules", exact: true })
    .getByRole("link", { name: "CRM", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Customer relationships" }),
  ).toBeVisible();
  await expect(
    page.getByRole("dialog", { name: "Sidebar", exact: true }),
  ).toHaveCount(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: "../../artifacts/modules/crm-mobile.png" });
  await page.keyboard.press("Control+k");
  const palette = page.getByRole("dialog", { name: "Search your workspace" });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: "../../artifacts/modules/command-mobile.png" });
  await palette
    .getByRole("combobox", { name: "Search workspace records" })
    .fill("Launch");
  await expect(palette.getByRole("option", { name: /Launch/ })).toBeVisible();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(new RegExp(`/boards/${board}$`), {
    timeout: navigationTimeout,
  });
  await expect(palette).toHaveCount(0);
  const anonymous = await browser.newContext();
  const visitor = await anonymous.newPage();
  await visitor.goto("/crm");
  await expect(visitor).toHaveURL(/\/sign-in/, { timeout: navigationTimeout });
  await expect(
    visitor.getByRole("heading", { name: "Customer relationships" }),
  ).toHaveCount(0);
  await anonymous.close();
});

test("archived Command search includes authorized projects and their boards with bounded pages", async ({
  page,
  browser,
}) => {
  test.setTimeout(60_000);
  const { owner, workspace } = await setup(page);
  const db = getDatabase();
  const now = new Date();
  const makeProject = (id: string, name: string, extra = {}) => ({
    id,
    name,
    workspaceId: workspace.id,
    createdById: owner.id,
    color: "teal",
    position: 0,
    ...extra,
  });
  const active = createRecordId();
  const archived = Array.from({ length: 26 }, () => createRecordId());
  const hidden = createRecordId(),
    deleted = createRecordId();
  await db.project.createMany({
    data: [
      makeProject(active, "History current"),
      ...archived.map((id, i) =>
        makeProject(id, `History archive ${i}`, { archivedAt: now }),
      ),
      makeProject(hidden, "History confidential", {
        visibility: "PRIVATE",
        archivedAt: now,
      }),
      makeProject(deleted, "History trashed", {
        archivedAt: now,
        deletedAt: now,
      }),
    ],
  });
  const boardId = createRecordId();
  await db.board.createMany({
    data: [
      {
        id: boardId,
        name: "History board",
        workspaceId: workspace.id,
        projectId: archived[0],
        createdById: owner.id,
      },
      {
        name: "History secret board",
        workspaceId: workspace.id,
        projectId: hidden,
        createdById: owner.id,
      },
      {
        name: "History trashed board",
        workspaceId: workspace.id,
        projectId: deleted,
        createdById: owner.id,
      },
      {
        name: "History deleted board",
        workspaceId: workspace.id,
        projectId: archived[0],
        createdById: owner.id,
        deletedAt: now,
      },
    ],
  });
  const read = async (kind: string, archive: boolean, cursor?: string) => {
    const params = new URLSearchParams({
      kind,
      q: "History",
      archived: String(archive),
    });
    if (cursor) params.set("cursor", cursor);
    const response = await page.request.get(
      `/api/v1/search/navigation?${params}`,
    );
    expect(response.status()).toBe(200);
    return (await response.json()).data;
  };
  const first = await read("project", true);
  expect(first.total).toBe(26);
  expect(first.items).toHaveLength(20);
  const second = await read("project", true, first.nextCursor);
  expect(second.items).toHaveLength(6);
  expect(second.nextCursor).toBeNull();
  expect(
    new Set(
      [...first.items, ...second.items].map((item: { id: string }) => item.id),
    ).size,
  ).toBe(26);
  expect(
    (await read("project", false)).items.map((item: { id: string }) => item.id),
  ).toEqual([active]);
  const boards = await read("board", true);
  expect(boards.total).toBe(1);
  expect(boards.items[0]).toMatchObject({ id: boardId, archived: true });
  expect((await read("board", false)).total).toBe(0);
  await page.goto("/boards");
  await page
    .getByRole("navigation", { name: "Modules", exact: true })
    .getByRole("link", { name: "CRM", exact: true })
    .click();
  await expect(page).toHaveURL(/\/crm$/);
  await page.keyboard.press("Control+k");
  const palette = page.getByRole("dialog", { name: "Search your workspace" });
  await palette
    .getByRole("combobox", { name: "Search workspace records" })
    .fill("History");
  await expect(
    palette.getByRole("option", { name: /History current/ }),
  ).toBeVisible();
  await palette
    .getByRole("checkbox", { name: "Search archived", exact: true })
    .check();
  const projectMatches = palette.getByRole("region", {
    name: "Matching projects",
  });
  await expect(projectMatches.getByRole("option")).toHaveCount(20);
  await projectMatches
    .getByRole("button", { name: "Show more projects" })
    .focus();
  await page.keyboard.press("Enter");
  await expect(projectMatches.getByRole("option")).toHaveCount(26);
  await expect(
    palette.getByText("History confidential", { exact: true }),
  ).toHaveCount(0);
  await expect(
    palette.getByText("History trashed", { exact: true }),
  ).toHaveCount(0);
  await expect(
    palette.getByRole("option", { name: /History current/ }),
  ).toHaveCount(0);
  await palette
    .getByRole("region", { name: "Matching boards" })
    .getByRole("option", { name: /History board/ })
    .click();
  await expect(page).toHaveURL(new RegExp(`/boards/${boardId}$`));
  const denied = await post(page, "/api/v1/boards/create-task", {
    boardId,
    name: "Cannot write",
    createKey: createRecordId(),
  });
  expect(denied.status()).toBe(403);
  const anonymous = await browser.newContext();
  expect(
    (
      await anonymous.request.get(
        `${ORIGIN}/api/v1/search/navigation?kind=project&archived=true`,
      )
    ).status(),
  ).toBe(401);
  await anonymous.close();
});
