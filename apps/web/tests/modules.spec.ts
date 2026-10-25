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

test("boards archive independently, preserve task states and restore without bypassing project archives", async ({
  page,
  browser,
}) => {
  test.setTimeout(90_000);
  const { owner, workspace, board } = await setup(page);
  const db = getDatabase();
  const taskId = (
    await ok(
      await post(page, "/api/v1/boards/create-task", {
        boardId: board,
        name: "Kept task",
        createKey: createRecordId(),
      }),
    )
  ).taskId as string;
  const separatelyArchivedId = (
    await ok(
      await post(page, "/api/v1/boards/create-task", {
        boardId: board,
        name: "Previously archived",
        createKey: createRecordId(),
      }),
    )
  ).taskId as string;
  const separatelyArchived = await db.task.findUniqueOrThrow({
    where: { id: separatelyArchivedId },
  });
  await ok(
    await post(page, "/api/v1/boards/archive", {
      taskId: separatelyArchivedId,
      revision: separatelyArchived.revision,
    }),
  );
  const individualArchive = (
    await db.task.findUniqueOrThrow({ where: { id: separatelyArchivedId } })
  ).archivedAt;
  const oldTask = await db.task.findUniqueOrThrow({ where: { id: taskId } });
  const state = async () => {
    const response = await page.request.get(
      `/api/v1/boards/state?boardId=${board}`,
    );
    expect(response.status()).toBe(200);
    return (await response.json()).data;
  };
  const archive = async (archived: boolean, version?: string) =>
    post(page, "/api/v1/boards/archive-board", {
      boardId: board,
      archived,
      version: version ?? (await state()).boardVersion,
    });
  const originalVersion = (await state()).boardVersion;
  const memberId = createRecordId();
  await db.user.create({
    data: {
      id: memberId,
      name: "Archive member",
      email: "archive-member@example.test",
      emailVerified: true,
      accounts: {
        create: {
          accountId: memberId,
          providerId: "credential",
          password: await (
            await import("better-auth/crypto")
          ).hashPassword("archive-member-password-123"),
        },
      },
      memberships: { create: { workspaceId: workspace.id } },
    },
  });
  const member = await browser.newContext({ baseURL: ORIGIN });
  expect(
    (
      await member.request.post("/api/v1/session/sign-in", {
        headers: { origin: ORIGIN },
        data: {
          email: "archive-member@example.test",
          password: "archive-member-password-123",
        },
      })
    ).status(),
  ).toBe(200);
  const unauthorized = await member.request.post(
    "/api/v1/boards/archive-board",
    {
      headers: { origin: ORIGIN },
      data: { boardId: board, archived: true, version: originalVersion },
    },
  );
  expect(unauthorized.status()).toBe(403);
  await member.close();

  await page.goto(`/boards/${board}`);
  // A client navigation ensures shortcut/event listeners have mounted.
  await page
    .getByRole("navigation", { name: "Modules", exact: true })
    .getByRole("link", { name: "CRM", exact: true })
    .click();
  await page
    .getByRole("navigation", { name: "Modules", exact: true })
    .getByRole("link", { name: "Work", exact: true })
    .click();
  await page.goto(`/boards/${board}`);
  await page
    .getByRole("button", { name: "Archive board", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "Archive Launch?" });
  await dialog
    .getByRole("button", { name: "Archive board", exact: true })
    .click();
  await expect(
    page.getByText("Archived board, read-only.", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Add task", exact: true }),
  ).toBeDisabled();
  await expect(
    page
      .getByRole("navigation", { name: "Workspace boards" })
      .getByRole("link", { name: "Launch", exact: true }),
  ).toHaveCount(0);
  const archivedState = await state();
  expect(archivedState.readOnly).toBe(true);
  expect(
    archivedState.tasks.find((task: { id: string }) => task.id === taskId)
      .canEdit,
  ).toBe(false);
  const unchanged = await db.task.findUniqueOrThrow({ where: { id: taskId } });
  expect(unchanged.archivedAt).toEqual(oldTask.archivedAt);
  expect(unchanged.revision).toBe(oldTask.revision);
  expect((await archive(false, originalVersion)).status()).toBe(409);
  for (const [path, body] of [
    [
      "create-task",
      { boardId: board, name: "Blocked task", createKey: createRecordId() },
    ],
    [
      "comment",
      {
        taskId,
        body: "Blocked comment",
        createKey: createRecordId(),
        mentionIds: [],
      },
    ],
    ["group", { boardId: board, name: "Blocked group" }],
  ] as const) {
    const response = await post(page, `/api/v1/boards/${path}`, body);
    expect(response.status(), await response.text()).toBe(403);
  }
  const search = async (archived: boolean) => {
    const response = await page.request.get(
      `/api/v1/search/navigation?kind=board&q=Launch&archived=${archived}`,
    );
    return (await response.json()).data.items;
  };
  expect(await search(false)).toHaveLength(0);
  expect(await search(true)).toEqual([
    expect.objectContaining({ id: board, archiveSource: "board" }),
  ]);
  await page.goto("/boards?archived=true");
  await expect(
    page.getByRole("heading", { name: "Launch", exact: true }),
  ).toBeVisible();
  await ok(await archive(false));
  expect((await state()).readOnly).toBe(false);
  expect(
    (await db.task.findUniqueOrThrow({ where: { id: separatelyArchivedId } }))
      .archivedAt,
  ).toEqual(individualArchive);
  // Managers cannot silently recover edit access through an archived parent.
  const project = await db.project.create({
    data: {
      name: "Archive parent",
      position: 0,
      workspaceId: workspace.id,
      createdById: owner.id,
      color: "teal",
    },
  });
  await db.board.update({
    where: { id: board },
    data: { projectId: project.id },
  });
  await ok(await archive(true));
  await db.project.update({
    where: { id: project.id },
    data: { archivedAt: new Date() },
  });
  await ok(await archive(false));
  expect((await state()).readOnly).toBe(true);
  expect((await state()).projectArchived).toBe(true);
  await ok(await archive(true));
  await db.project.update({
    where: { id: project.id },
    data: { archivedAt: null },
  });
  expect((await state()).readOnly).toBe(true);
  await ok(await archive(false));
  expect((await state()).readOnly).toBe(false);
  const history = await db.boardEvent.count({
    where: {
      boardId: board,
      action: { in: ["Archived board", "Restored board"] },
    },
  });
  expect(history).toBe(6);
  await db.installationSettings.update({
    where: { id: "installation" },
    data: { maintenanceMode: true },
  });
  expect((await archive(true)).status()).toBe(503);
});

test("subitems create, edit, search and inherit parent lifecycle without changing task totals", async ({
  page,
}) => {
  const { owner, workspace, board } = await setup(page);
  const db = getDatabase();
  const root = await ok(
    await post(page, "/api/v1/boards/create-task", {
      boardId: board,
      name: "Ship the website",
      createKey: createRecordId(),
    }),
  );
  let childId: string | undefined;
  try {
    await page.goto(`/boards/${board}?task=${root.taskId}`);
    const sheet = page.getByRole("dialog");
    await sheet
      .getByRole("textbox", { name: "Subitem name", exact: true })
      .fill("Design the header");
    await sheet
      .getByRole("button", { name: "Add subitem", exact: true })
      .click();
    await expect(
      sheet.locator(".subitem-open").filter({ hasText: "Design the header" }),
    ).toBeVisible();
    const childLink = sheet
      .locator(".subitem-open")
      .filter({ hasText: "Design the header" });
    await childLink.hover();
    await expect(childLink).toHaveCSS("cursor", "pointer");
    await expect(childLink).toHaveCSS("text-decoration-line", "underline");
    await page.screenshot({ path: "../../artifacts/subitems-desktop.png" });
    childId = (
      await db.task.findFirstOrThrow({ where: { parentId: root.taskId } })
    ).id;
    const state = await ok(
      await page.request.get(
        `/api/v1/boards/state?boardId=${board}&query=${encodeURIComponent(JSON.stringify({ taskId: childId }))}`,
      ),
    );
    expect(state.tasks.map((t: { id: string }) => t.id)).toEqual([root.taskId]);
    expect(state.focusedTask.parentName).toBe("Ship the website");
    expect(state.tasks[0].childSummary).toEqual({ total: 1, done: 0 });
    await sheet
      .locator(".subitem-open")
      .filter({ hasText: "Design the header" })
      .click();
    await expect(
      sheet.getByText("Subitem of", { exact: false }).first(),
    ).toBeVisible();
    await expect(
      sheet.getByRole("combobox", { name: "Task group", exact: true }),
    ).toBeDisabled();
    // Saving a child keeps its sheet open and makes the latest revision editable.
    await sheet
      .getByRole("textbox", { name: "Task name", exact: true })
      .fill("Design the navigation");
    await sheet
      .getByRole("button", { name: "Save changes", exact: true })
      .click();
    await expect(sheet).toBeVisible();
    await expect(
      sheet.getByRole("textbox", { name: "Task name", exact: true }),
    ).toHaveValue("Design the navigation");
    await expect(
      sheet.getByRole("button", { name: "Save changes", exact: true }),
    ).toBeHidden();
    await sheet
      .getByRole("textbox", { name: "Task name", exact: true })
      .fill("Navigation draft");
    await expect(
      sheet.getByRole("button", { name: "Save changes", exact: true }),
    ).toBeEnabled();
    await sheet
      .getByRole("textbox", { name: "Task name", exact: true })
      .fill("Design the navigation");
    await ok(
      await post(page, "/api/v1/boards/update", {
        taskId: childId,
        revision: 2,
        changes: {
          assigneeIds: [owner.id],
          startDate: "2026-10-25",
          dueDate: "2026-10-31",
        },
      }),
    );
    const search = await ok(
      await page.request.get("/api/v1/search/tasks?q=navigation"),
    );
    expect(search.tasks[0]).toMatchObject({
      id: childId,
      parentId: root.taskId,
      recordName: "Subitem",
    });
    await ok(
      await post(page, "/api/v1/boards/comment", {
        taskId: childId,
        createKey: createRecordId(),
        body: "Ready for review",
        mentionIds: [],
      }),
    );
    expect(
      (
        await ok(
          await page.request.get(`/api/v1/boards/comments?taskId=${childId}`),
        )
      )[0].body,
    ).toBe("Ready for review");
    expect(
      (
        await page.request.get(`/api/v1/attachments?taskId=${childId}`)
      ).status(),
    ).toBe(200);
    const upload = await page.request.post(
      `/api/v1/attachments?taskId=${childId}`,
      {
        headers: {
          origin: ORIGIN,
          "content-type": "text/plain",
          "x-yuzu-file-name": "subitem-notes.txt",
          "x-yuzu-upload-key": createRecordId(),
        },
        data: Buffer.from("Notes attached to this subitem.\n"),
      },
    );
    expect(upload.status(), await upload.text()).toBe(201);
    const fileId = (await upload.json()).data.id;
    expect(
      (await page.request.get(`/api/v1/attachments/${fileId}`)).status(),
    ).toBe(200);
    const config = {
      layout: "table",
      scope: "SUBITEMS",
      search: "navigation",
      groupId: null,
      statusId: null,
      sort: "created",
      archived: false,
      assignee: "me",
      priority: "all",
      due: "all",
    };
    const children = await ok(
      await page.request.get(
        `/api/v1/boards/state?boardId=${board}&query=${encodeURIComponent(JSON.stringify({ config }))}`,
      ),
    );
    expect(children.tasks.map((t: { id: string }) => t.id)).toEqual([childId]);
    const range = { config, from: "2026-10-01", to: "2026-11-01" };
    const calendar = await ok(
      await page.request.get(
        `/api/v1/boards/calendar?boardId=${board}&query=${encodeURIComponent(JSON.stringify(range))}`,
      ),
    );
    expect(calendar.tasks.map((t: { id: string }) => t.id)).toEqual([childId]);
    const timeline = await ok(
      await page.request.get(
        `/api/v1/boards/timeline?boardId=${board}&query=${encodeURIComponent(JSON.stringify(range))}`,
      ),
    );
    expect(timeline.tasks.map((t: { id: string }) => t.id)).toEqual([childId]);
    const dashboard = await ok(
      await page.request.get(`/api/v1/dashboard?workspaceId=${workspace.id}`),
    );
    expect(dashboard.total).toBe(1);
    expect(dashboard.subitems).toMatchObject({ total: 1, mine: 1 });
    expect(
      (
        await post(page, "/api/v1/boards/update", {
          taskId: childId,
          revision: 3,
          changes: { groupId: null },
        })
      ).status(),
    ).toBe(422);
    expect(
      (
        await post(page, "/api/v1/boards/create-task", {
          boardId: board,
          parentId: childId,
          name: "Nested",
          createKey: createRecordId(),
        })
      ).status(),
    ).toBe(404);
    const csv = await post(page, "/api/v1/boards/export", {
      boardId: board,
      scope: "BOARD",
      includeArchived: false,
    });
    expect(csv.status()).toBe(200);
    expect(await csv.text()).not.toContain("Design the navigation");
    const readToken = await ok(
      await post(page, "/api/v1/tokens/create", {
        name: "Subitem read",
        access: "READ",
        expires: "30",
      }),
    );
    expect(
      (
        await page.request.get(
          `/api/v1/boards/subitems?boardId=${board}&parentId=${root.taskId}`,
          { headers: { authorization: `Bearer ${readToken.token}` } },
        )
      ).status(),
    ).toBe(200);
    expect(
      (
        await page.request.post("/api/v1/boards/update", {
          headers: { authorization: `Bearer ${readToken.token}` },
          data: {
            taskId: childId,
            revision: 2,
            changes: { name: "No read-token write" },
          },
        })
      ).status(),
    ).toBe(403);
    const writeToken = await ok(
      await post(page, "/api/v1/tokens/create", {
        name: "Subitem write",
        access: "WRITE",
        expires: "30",
      }),
    );
    const tokenInput = {
      boardId: board,
      parentId: root.taskId,
      name: "Token subitem",
      createKey: createRecordId(),
    };
    const tokenCreate = await page.request.post("/api/v1/boards/create-task", {
      headers: { authorization: `Bearer ${writeToken.token}` },
      data: tokenInput,
    });
    const tokenChild = await ok(tokenCreate);
    expect(
      (
        await ok(
          await page.request.post("/api/v1/boards/create-task", {
            headers: { authorization: `Bearer ${writeToken.token}` },
            data: tokenInput,
          }),
        )
      ).taskId,
    ).toBe(tokenChild.taskId);
    await page.goto(`/boards/${board}?layout=table`);
    await page
      .getByRole("button", {
        name: "Subitems of Ship the website",
        exact: true,
      })
      .click();
    await expect(
      page.locator(`tr[data-subitem="true"][data-task-id="${childId}"]`),
    ).toContainText("Design the navigation");
    await page
      .getByRole("combobox", { name: "Record scope" })
      .selectOption("SUBITEMS");
    await expect(page.locator(`tr[data-task-id="${root.taskId}"]`)).toHaveCount(
      0,
    );
    await expect(page.locator(`tr[data-task-id="${childId}"]`)).toHaveCount(1);
    await page
      .getByRole("combobox", { name: "Record scope" })
      .selectOption("BOTH");
    await expect(page.locator(`tr[data-task-id="${root.taskId}"]`)).toHaveCount(
      1,
    );
    await expect(page.locator(`tr[data-task-id="${childId}"]`)).toHaveCount(1);
    const viewId = createRecordId();
    await ok(
      await post(page, "/api/v1/boards/save-view", {
        boardId: board,
        id: viewId,
        revision: 0,
        name: "My subitems",
        visibility: "PERSONAL",
        config,
      }),
    );
    const saved = await ok(
      await page.request.get(`/api/v1/boards/state?boardId=${board}`),
    );
    expect(
      saved.savedViews.find((v: { id: string }) => v.id === viewId).config
        .scope,
    ).toBe("SUBITEMS");
    const parent = await db.task.findUniqueOrThrow({
      where: { id: root.taskId },
    });
    expect(
      (
        await post(page, "/api/v1/boards/archive", {
          taskId: root.taskId,
          revision: parent.revision,
        })
      ).status(),
    ).toBe(409);
    await ok(
      await post(page, "/api/v1/boards/archive", {
        taskId: root.taskId,
        revision: parent.revision,
        childrenRevision: parent.childrenRevision,
      }),
    );
    expect(
      (await ok(await page.request.get("/api/v1/search/tasks?q=navigation")))
        .total,
    ).toBe(0);
    expect(
      (
        await ok(
          await page.request.get(
            "/api/v1/search/tasks?q=navigation&archived=true",
          ),
        )
      ).total,
    ).toBe(1);
    expect(
      (
        await post(page, "/api/v1/boards/update", {
          taskId: childId,
          revision: 2,
          changes: { name: "Forbidden" },
        })
      ).status(),
    ).toBe(403);
    await page.goto(`/boards/${board}?task=${childId}`);
    await expect(
      page.getByRole("dialog").getByText("Ship the website", { exact: true }),
    ).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByRole("dialog")).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: "../../artifacts/subitems-mobile-light.png",
    });
    await page
      .context()
      .addCookies([{ name: "yuzu-mode", value: "dark", url: ORIGIN }]);
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-mode", "dark");
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(
      page.getByRole("dialog").getByText("Ship the website", { exact: true }),
    ).toBeVisible();
    await page.screenshot({
      path: "../../artifacts/subitems-mobile-dark.png",
      animations: "disabled",
    });
  } finally {
    await db.boardProposal.deleteMany({ where: { parentTaskId: root.taskId } });
    await db.task.deleteMany({ where: { parentId: root.taskId } });
  }
});

test("subitem Trash preserves independent flags and restores ancestors only with confirmation", async ({
  page,
}) => {
  const { board } = await setup(page);
  const db = getDatabase();
  const root = await ok(
    await post(page, "/api/v1/boards/create-task", {
      boardId: board,
      name: "Parent for Trash",
      createKey: createRecordId(),
    }),
  );
  const child = await ok(
    await post(page, "/api/v1/boards/create-task", {
      boardId: board,
      parentId: root.taskId,
      name: "Independent child Trash",
      createKey: createRecordId(),
    }),
  );
  try {
    await ok(
      await post(page, "/api/v1/trash/delete-record", {
        id: child.taskId,
        revision: 1,
      }),
    );
    const parent = await db.task.findUniqueOrThrow({
      where: { id: root.taskId },
    });
    await ok(
      await post(page, "/api/v1/trash/delete-record", {
        id: root.taskId,
        revision: parent.revision,
        childrenRevision: parent.childrenRevision,
      }),
    );
    const trash = await ok(
      await page.request.get(`/api/v1/trash/list?boardId=${board}`),
    );
    expect(
      trash.records.find((r: { id: string }) => r.id === root.taskId),
    ).toMatchObject({ childCount: 1 });
    expect(
      trash.records.find((r: { id: string }) => r.id === child.taskId),
    ).toMatchObject({ parentId: root.taskId, parentDeleted: true });
    expect(
      (
        await post(page, "/api/v1/trash/restore-record", {
          id: child.taskId,
          withParents: false,
        })
      ).status(),
    ).toBe(409);
    await ok(
      await post(page, "/api/v1/trash/restore-record", {
        id: child.taskId,
        withParents: true,
      }),
    );
    expect(
      (await db.task.findUniqueOrThrow({ where: { id: root.taskId } }))
        .deletedAt,
    ).toBeNull();
    expect(
      (await db.task.findUniqueOrThrow({ where: { id: child.taskId } }))
        .deletedAt,
    ).toBeNull();
  } finally {
    await db.task.deleteMany({ where: { parentId: root.taskId } });
  }
});

test("protected child requests retain parent context and linked rollups refresh on inherited archive", async ({
  page,
  browser,
}) => {
  const { workspace, board } = await setup(page);
  const db = getDatabase();
  const root = await ok(
    await post(page, "/api/v1/boards/create-task", {
      boardId: board,
      name: "Parent with approvals",
      createKey: createRecordId(),
    }),
  );
  const reviewerId = createRecordId();
  const reviewer = await db.user.create({
    data: {
      id: reviewerId,
      accounts: {
        create: {
          accountId: reviewerId,
          providerId: "credential",
          password: await (
            await import("better-auth/crypto")
          ).hashPassword("subitem-reviewer-password-123"),
        },
      },
      name: "Subitem reviewer",
      email: "reviewer@example.test",
      emailVerified: true,
      role: "MEMBER",
      memberships: { create: { workspaceId: workspace.id } },
    },
  });
  const reviewerContext = await browser.newContext({ baseURL: ORIGIN });
  expect(
    (
      await reviewerContext.request.post("/api/v1/session/sign-in", {
        headers: { origin: ORIGIN },
        data: {
          email: reviewer.email,
          password: "subitem-reviewer-password-123",
        },
      })
    ).status(),
  ).toBe(200);
  const nameField = await db.boardColumn.findFirstOrThrow({
    where: { boardId: board, key: "name" },
  });
  await ok(
    await post(page, "/api/v1/approvals/configure", {
      boardId: board,
      version: 0,
      enabled: true,
      requireCreation: true,
      requireChanges: true,
      requireArchive: false,
      protectedFieldIds: [nameField.id],
      primaryApproverId: reviewer.id,
      backupApproverId: null,
    }),
  );
  const decide = (proposalId: string) =>
    reviewerContext.request.post("/api/v1/approvals/decide", {
      headers: { origin: ORIGIN },
      data: { proposalId, action: "approve" },
    });
  try {
    await page.goto(`/boards/${board}?task=${root.taskId}`);
    const sheet = page.getByRole("dialog");
    await sheet
      .getByRole("textbox", { name: "Subitem name", exact: true })
      .fill("Protected child");
    await sheet
      .getByRole("button", { name: "Add subitem", exact: true })
      .click();
    await expect(
      sheet.getByRole("link", { name: "View requests", exact: true }),
    ).toBeVisible();
    await expect(
      sheet
        .getByRole("status")
        .filter({ hasText: "Subitem sent for approval." }),
    ).toContainText("Subitem sent for approval.");
    const pending = {
      proposalId: (
        await db.boardProposal.findFirstOrThrow({
          where: { parentTaskId: root.taskId, status: "PENDING" },
        })
      ).id,
    };
    expect(await db.task.count({ where: { parentId: root.taskId } })).toBe(0);
    const queue = await ok(
      await reviewerContext.request.get("/api/v1/approvals/queue"),
    );
    expect(
      queue.proposals.find((p: { id: string }) => p.id === pending.proposalId),
    ).toMatchObject({
      canDecide: true,
      name: "Protected child · Subitem of Parent with approvals",
    });
    expect(
      (
        await post(page, "/api/v1/approvals/decide", {
          proposalId: pending.proposalId,
          action: "approve",
        })
      ).status(),
    ).toBe(403);
    const applied = await ok(await decide(pending.proposalId));
    const childId = applied.taskId;
    expect((await decide(pending.proposalId)).status()).toBe(409);
    const change = await ok(
      await post(page, "/api/v1/boards/update", {
        taskId: childId,
        revision: 1,
        changes: { name: "Accepted child edit" },
      }),
    );
    await ok(
      await post(page, "/api/v1/boards/update", {
        taskId: root.taskId,
        revision: 1,
        changes: { description: "Unrelated parent notes" },
      }),
    );
    expect((await ok(await decide(change.proposalId))).status).toBe("APPROVED");
    expect(
      (await db.task.findUniqueOrThrow({ where: { id: childId } })).name,
    ).toBe("Accepted child edit");
    const linkedBoard = await ok(
      await post(page, "/api/v1/boards/create-board", {
        workspaceId: workspace.id,
        name: "Linked workload",
      }),
    );
    const linkedRoot = await ok(
      await post(page, "/api/v1/boards/create-task", {
        boardId: linkedBoard.id,
        name: "Linked record",
        createKey: createRecordId(),
      }),
    );
    const relation = await ok(
      await post(page, "/api/v1/boards/field", {
        boardId: linkedBoard.id,
        name: "Work links",
        type: "RELATION",
        relation: {
          targetBoardId: board,
          many: true,
          mirrorMany: true,
          mirrorName: "Related records",
        },
      }),
    );
    const rollup = await ok(
      await post(page, "/api/v1/boards/field", {
        boardId: linkedBoard.id,
        name: "Linked count",
        type: "ROLLUP",
        rollup: {
          relationFieldId: relation.id,
          aggregate: "count",
          targetFieldId: null,
        },
      }),
    );
    await ok(
      await post(page, "/api/v1/boards/update", {
        taskId: linkedRoot.taskId,
        revision: 1,
        changes: { fieldValues: { [relation.id]: [childId] } },
      }),
    );
    const mirror = await db.boardColumn.findFirstOrThrow({
      where: { boardId: board, type: "RELATION", name: "Related records" },
    });
    const childRollup = await ok(
      await post(page, "/api/v1/boards/field", {
        boardId: board,
        name: "Child linked count",
        type: "ROLLUP",
        rollup: {
          relationFieldId: mirror.id,
          aggregate: "count",
          targetFieldId: null,
        },
      }),
    );
    const breakdown = await ok(
      await page.request.get(
        `/api/v1/boards/subitems?boardId=${board}&parentId=${root.taskId}`,
      ),
    );
    expect(breakdown.items[0].fieldValues[childRollup.id]).toBe(1);
    expect(breakdown.linked[linkedRoot.taskId].name).toBe("Linked record");
    await page.goto(`/boards/${linkedBoard.id}?layout=table`);
    await expect(page.locator(".board-surface")).toHaveAttribute(
      "data-connection",
      "live",
    );
    const row = page.locator(`tr[data-task-id="${linkedRoot.taskId}"]`);
    await expect(
      row.getByRole("cell", { name: "1", exact: true }),
    ).toBeVisible();
    const parent = await db.task.findUniqueOrThrow({
      where: { id: root.taskId },
    });
    await ok(
      await post(page, "/api/v1/boards/archive", {
        taskId: root.taskId,
        revision: parent.revision,
        childrenRevision: parent.childrenRevision,
      }),
    );
    await expect(row.getByRole("cell", { name: "0", exact: true })).toBeVisible(
      { timeout: 10000 },
    );
    const linked = await ok(
      await page.request.get(`/api/v1/boards/state?boardId=${linkedBoard.id}`),
    );
    expect(linked.tasks[0].fieldValues[rollup.id]).toBe(0);
  } finally {
    await reviewerContext.close();
    await db.boardProposal.deleteMany({ where: { boardId: board } });
    await db.task.deleteMany({ where: { parentId: root.taskId } });
  }
});
