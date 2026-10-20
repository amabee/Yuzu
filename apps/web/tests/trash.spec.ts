import { test, expect, type Page } from "@playwright/test";
import { createRecordId, getDatabase } from "@yuzu/database";
import { startTestCsvWorker, stopTestCsvWorker } from "./csv-worker-process";

process.env.DATABASE_URL = process.env.YUZU_E2E_DATABASE_URL;
const ORIGIN = "http://127.0.0.1:3100";
const MIA_PASSWORD = "mia-member-password-123";
import { projectColors } from "../src/lib/project-contract";
const PROJECT_COLOR = projectColors[0];

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
const create = async (page: Page, boardId: string, name: string, extra = {}) =>
  (
    await ok(
      await post(page, "/api/v1/boards/create-task", {
        boardId,
        createKey: crypto.randomUUID(),
        name,
        ...extra,
      }),
    )
  ).taskId as string;
const state = (page: Page, boardId: string) =>
  page.request.get(`/api/v1/boards/state?boardId=${boardId}`);

test("managers delete and restore records, boards and projects; members can't", async ({
  page,
  browser,
}) => {
  test.setTimeout(120_000);
  const { owner, workspace, board } = await setup(page);
  const db = getDatabase();
  const plan = await create(page, board, "Launch plan");
  await create(page, board, "Press kit");

  // A member who isn't a manager can't delete.
  const memberId = createRecordId();
  await db.user.create({
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
    data: { workspaceId: workspace.id, userId: memberId },
  });
  const mia = await browser.newContext();
  const miaPage = await mia.newPage();
  await ok(
    await post(miaPage, "/api/v1/session/sign-in", {
      email: "mia@example.test",
      password: MIA_PASSWORD,
    }),
  );
  expect(
    (await post(miaPage, "/api/v1/trash/delete-record", { id: plan })).status(),
  ).toBe(403);

  // Delete from the record panel with the alert dialog.
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`/boards/${board}?task=${plan}`);
  await page.getByRole("button", { name: "More task actions" }).click();
  await page.getByRole("menuitem", { name: "Delete task…" }).click();
  const confirm = page.getByRole("dialog", { name: "Delete “Launch plan”?" });
  await expect(confirm).toBeVisible();
  await page.screenshot({ path: "../../artifacts/trash/delete-record.png" });
  await confirm.getByRole("button", { name: "Delete task" }).click();
  await expect(
    page.getByRole("button", { name: "Launch plan", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Press kit", exact: true }),
  ).toBeVisible();
  const deleted = await db.task.findUniqueOrThrow({ where: { id: plan } });
  expect(deleted.deletedAt).not.toBeNull();
  // Gone everywhere: search and the member's board.
  const search = await (
    await page.request.get("/api/v1/search/tasks?q=launch plan")
  ).json();
  expect(search.data.total).toBe(0);
  const miaState = await (await state(miaPage, board)).json();
  expect(
    miaState.data.tasks.map((task: { name: string }) => task.name),
  ).toEqual(["Press kit"]);
  expect(
    (await page.request.get(`/api/v1/boards/comments?taskId=${plan}`)).status(),
  ).toBe(404);

  // The board's Deleted view restores it.
  await page.getByRole("button", { name: "Deleted", exact: true }).click();
  const deletedView = page.getByRole("dialog", { name: "Deleted tasks" });
  await deletedView
    .getByRole("button", { name: "Restore Launch plan" })
    .click();
  await expect(deletedView).toContainText(
    "Nothing from this board is in Trash.",
  );
  await deletedView.getByText("Close", { exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Launch plan", exact: true }),
  ).toBeVisible();

  // Deleting the board hides it and its records; Trash restores it.
  await page
    .getByRole("button", { name: "Board details", exact: true })
    .click();
  await page.getByRole("button", { name: "Delete board…" }).click();
  const boardConfirm = page.getByRole("dialog", { name: "Delete this board?" });
  await expect(boardConfirm).toContainText("2 tasks move to Trash");
  await boardConfirm.getByRole("button", { name: "Delete board" }).click();
  await page.waitForURL("**/boards");
  await expect(
    page.getByRole("link", { name: "Launch", exact: true }),
  ).toHaveCount(0);
  expect((await state(page, board)).status()).toBe(404);
  expect((await state(miaPage, board)).status()).toBe(404);
  await page.goto("/settings/trash");
  await page.getByRole("button", { name: /^Boards 1/ }).click();
  await page.screenshot({ path: "../../artifacts/trash/settings.png" });
  await page.getByRole("button", { name: "Restore Launch" }).click();
  await expect(page.getByText("Restored.", { exact: true })).toBeVisible();
  expect((await state(page, board)).status()).toBe(200);

  // A project in Trash hides its boards until restored.
  const project = await ok(
    await post(page, "/api/v1/projects/create", {
      workspaceId: workspace.id,
      name: "Website",
      color: PROJECT_COLOR,
      visibility: "PUBLIC",
    }),
  );
  const projectBoard = (
    await ok(
      await post(page, "/api/v1/boards/create-board", {
        projectId: project.id,
        name: "Pages",
      }),
    )
  ).id as string;
  const page1 = await create(page, projectBoard, "Home page");
  await ok(await post(page, "/api/v1/trash/delete-record", { id: page1 }));
  await ok(
    await post(page, "/api/v1/trash/delete-project", { id: project.id }),
  );
  expect((await state(page, projectBoard)).status()).toBe(404);
  // Restoring a record whose project is in Trash restores the project too.
  const blocked = await post(page, "/api/v1/trash/restore-record", {
    id: page1,
  });
  expect(blocked.status()).toBe(409);
  expect((await blocked.json()).error.code).toBe("PROJECT_DELETED");
  await ok(
    await post(page, "/api/v1/trash/restore-record", {
      id: page1,
      withParents: true,
    }),
  );
  expect((await state(page, projectBoard)).status()).toBe(200);

  const audit = await db.auditEvent.findMany({ select: { action: true } });
  expect(audit.map((item) => item.action)).toEqual(
    expect.arrayContaining([
      "BOARD_DELETED",
      "BOARD_RESTORED",
      "PROJECT_DELETED",
      "PROJECT_RESTORED",
    ]),
  );
  void owner;
  await mia.close();
});

test("links to deleted records hide, and admins erase Trash for good", async ({
  page,
}) => {
  test.setTimeout(150_000);
  const { workspace, board } = await setup(page);
  const db = getDatabase();
  const other = (
    await ok(
      await post(page, "/api/v1/boards/create-board", {
        workspaceId: workspace.id,
        name: "Deals",
        recordType: "DEAL",
      }),
    )
  ).id as string;
  await ok(
    await post(page, "/api/v1/boards/field", {
      boardId: other,
      name: "Tasks",
      type: "RELATION",
      options: [],
      relation: {
        targetBoardId: board,
        many: true,
        mirrorMany: false,
        mirrorName: "Deal",
      },
    }),
  );
  const link = await db.boardColumn.findFirstOrThrow({
    where: { boardId: other, name: "Tasks" },
  });
  const kickoff = await create(page, board, "Kickoff");
  const deal = await create(page, other, "Checkout", {
    fieldValues: { [link.id]: [kickoff] },
  });
  const linkedIds = async () =>
    (await (await state(page, other)).json()).data.tasks.find(
      (task: { id: string }) => task.id === deal,
    ).fieldValues[link.id] ?? [];
  expect(await linkedIds()).toEqual([kickoff]);
  await ok(await post(page, "/api/v1/trash/delete-record", { id: kickoff }));
  expect(await linkedIds()).toEqual([]);
  await ok(await post(page, "/api/v1/trash/restore-record", { id: kickoff }));
  expect(await linkedIds()).toEqual([kickoff]);

  // Erase one item, then empty Trash with type-to-confirm.
  const scrap = await create(page, board, "Scrap");
  await ok(await post(page, "/api/v1/trash/delete-record", { id: scrap }));
  await ok(await post(page, "/api/v1/trash/delete-record", { id: kickoff }));
  await page.goto("/settings/trash");
  await page.getByRole("button", { name: "Erase" }).first().click();
  const confirm = page.getByRole("dialog", { name: /for good\?$/ });
  await confirm.getByRole("button", { name: "Erase for good" }).click();
  await expect(
    page.getByText("Erased for good.", { exact: true }),
  ).toBeVisible();
  expect(await db.task.count({ where: { deletedAt: { not: null } } })).toBe(1);
  await page.getByRole("button", { name: "Empty Trash…" }).click();
  const empty = page.getByRole("dialog", {
    name: /^Erase \d+ items? for good\?$/,
  });
  await expect(
    empty.getByRole("button", { name: "Erase for good" }),
  ).toBeDisabled();
  await empty.getByLabel("Type erase to confirm").fill("erase");
  await empty.getByRole("button", { name: "Erase for good" }).click();
  await expect
    .poll(() => db.task.count({ where: { deletedAt: { not: null } } }))
    .toBe(0);
  expect(await db.recordLink.count()).toBe(0);
  expect(await db.auditEvent.count({ where: { action: "TRASH_ERASED" } })).toBe(
    2,
  );

  // Auto-erase removes items older than the chosen period.
  await page.getByLabel("Auto-erase Trash").selectOption("30");
  await expect(
    page.getByText("Auto-erase saved.", { exact: true }),
  ).toBeVisible();
  const old = await create(page, board, "Old notes");
  await ok(await post(page, "/api/v1/trash/delete-record", { id: old }));
  await db.task.update({
    where: { id: old },
    data: { deletedAt: new Date(Date.now() - 40 * 86_400_000) },
  });
  await expect
    .poll(() => db.task.count({ where: { id: old } }), {
      timeout: 100_000,
      intervals: [3_000],
    })
    .toBe(0);
});
