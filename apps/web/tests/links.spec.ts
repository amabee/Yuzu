import { test, expect, type Page } from "@playwright/test";
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
  const deals = (
    await ok(
      await post(page, "/api/v1/boards/create-board", {
        workspaceId: workspace.id,
        name: "Deals",
        recordType: "DEAL",
      }),
    )
  ).id as string;
  const delivery = (
    await ok(
      await post(page, "/api/v1/boards/create-board", {
        workspaceId: workspace.id,
        name: "Delivery",
      }),
    )
  ).id as string;
  return { owner, workspace, deals, delivery };
}

const field = (page: Page, boardId: string, data: Record<string, unknown>) =>
  post(page, "/api/v1/boards/field", { boardId, options: [], ...data });
const create = async (
  page: Page,
  boardId: string,
  data: Record<string, unknown>,
) =>
  (
    await ok(
      await post(page, "/api/v1/boards/create-task", {
        boardId,
        createKey: crypto.randomUUID(),
        ...data,
      }),
    )
  ).taskId as string;
const state = async (page: Page, boardId: string) =>
  ok(await page.request.get(`/api/v1/boards/state?boardId=${boardId}`));
const column = (boardId: string, name: string) =>
  getDatabase().boardColumn.findFirstOrThrow({
    where: { boardId, name, archivedAt: null },
  });

test("two-way links, one-or-many limits, rollups and private records", async ({
  page,
  browser,
}) => {
  test.setTimeout(120_000);
  const { owner, workspace, deals, delivery } = await setup(page);
  const db = getDatabase();

  // Each deal links to many delivery tasks; each task to one deal.
  await ok(
    await field(page, deals, {
      name: "Delivery tasks",
      type: "RELATION",
      relation: {
        targetBoardId: delivery,
        many: true,
        mirrorMany: false,
        mirrorName: "Deal",
      },
    }),
  );
  const link = await column(deals, "Delivery tasks");
  const mirror = await column(delivery, "Deal");
  await ok(await field(page, delivery, { name: "Hours", type: "NUMBER" }));
  const hours = await column(delivery, "Hours");
  await ok(
    await field(page, deals, {
      name: "Open tasks",
      type: "ROLLUP",
      rollup: { relationFieldId: link.id, aggregate: "count" },
    }),
  );
  await ok(
    await field(page, deals, {
      name: "Total hours",
      type: "ROLLUP",
      rollup: {
        relationFieldId: link.id,
        aggregate: "sum",
        targetFieldId: hours.id,
      },
    }),
  );
  const openTasks = await column(deals, "Open tasks");
  const totalHours = await column(deals, "Total hours");

  const kickoff = await create(page, delivery, {
    name: "Kickoff call",
    fieldValues: { [hours.id]: 3 },
  });
  const scope = await create(page, delivery, {
    name: "Scope doc",
    fieldValues: { [hours.id]: 5 },
  });
  const checkout = await create(page, deals, {
    name: "Checkout redesign",
    fieldValues: { [link.id]: [kickoff, scope] },
  });
  expect(await db.recordLink.count()).toBe(2);
  // The linked tasks show the deal through the mirror, without a new revision.
  const deliveryState = await state(page, delivery);
  const kickoffRow = deliveryState.tasks.find(
    (task: { id: string }) => task.id === kickoff,
  );
  expect(kickoffRow.fieldValues[mirror.id]).toEqual([checkout]);
  expect(kickoffRow.revision).toBe(1);
  expect(deliveryState.linked[checkout].name).toBe("Checkout redesign");
  expect(
    kickoffRow.activity.some(
      (item: { action: string }) => item.action === "Linked Checkout redesign",
    ),
  ).toBe(true);
  const dealRow = async () =>
    (await state(page, deals)).tasks.find(
      (task: { id: string }) => task.id === checkout,
    );
  expect((await dealRow()).fieldValues[openTasks.id]).toBe(2);
  expect((await dealRow()).fieldValues[totalHours.id]).toBe(8);

  // A task links to one deal: a second deal can't take it.
  const taken = await post(page, "/api/v1/boards/create-task", {
    boardId: deals,
    createKey: crypto.randomUUID(),
    name: "Support retainer",
    fieldValues: { [link.id]: [kickoff] },
  });
  expect(taken.status()).toBe(409);
  expect((await taken.json()).error.message).toContain("Kickoff call");
  // Rollups are read-only.
  expect(
    (
      await post(page, "/api/v1/boards/create-task", {
        boardId: deals,
        createKey: crypto.randomUUID(),
        name: "Nope",
        fieldValues: { [openTasks.id]: 9 },
      })
    ).status(),
  ).toBe(422);

  // Archived records drop out of rollups but keep their link.
  const kickoffTask = await db.task.findUniqueOrThrow({
    where: { id: kickoff },
  });
  await ok(
    await post(page, "/api/v1/boards/archive", {
      taskId: kickoff,
      revision: kickoffTask.revision,
      requestKey: crypto.randomUUID(),
    }),
  );
  expect((await dealRow()).fieldValues[openTasks.id]).toBe(1);
  expect((await dealRow()).fieldValues[totalHours.id]).toBe(5);
  expect(await db.recordLink.count()).toBe(2);

  // Make Delivery private to the owner; a member sees "Private item".
  const project = await db.project.create({
    data: {
      id: createRecordId(),
      workspaceId: workspace.id,
      name: "Private delivery",
      visibility: "PRIVATE",
      color: "#0B5A7A",
      position: 0,
      createdById: owner.id,
      members: {
        create: { userId: owner.id, role: "MANAGER", grantedById: owner.id },
      },
    },
  });
  await db.board.update({
    where: { id: delivery },
    data: { projectId: project.id },
  });
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
  await db.boardManager.create({
    data: { boardId: deals, userId: memberId, grantedById: owner.id },
  });
  const mia = await browser.newContext();
  const miaPage = await mia.newPage();
  await ok(
    await post(miaPage, "/api/v1/session/sign-in", {
      email: "mia@example.test",
      password: MIA_PASSWORD,
    }),
  );
  const miaDeals = await state(miaPage, deals);
  const miaDeal = miaDeals.tasks.find(
    (task: { id: string }) => task.id === checkout,
  );
  expect(miaDeal.fieldValues[link.id]).toHaveLength(2);
  expect(miaDeals.linked[scope]).toBeUndefined();
  expect(miaDeal.fieldValues[openTasks.id]).toBe(0);
  // Saving the deal with its private links (or none) never drops them.
  await ok(
    await post(miaPage, "/api/v1/boards/update", {
      taskId: checkout,
      revision: miaDeal.revision,
      requestKey: crypto.randomUUID(),
      changes: { fieldValues: { [link.id]: [] } },
    }),
  );
  expect(await db.recordLink.count()).toBe(2);
  await miaPage.goto(`/boards/${deals}`);
  await miaPage.getByRole("button", { name: "Table", exact: true }).click();
  await expect(miaPage.locator(`tr[data-task-id="${checkout}"]`)).toContainText(
    "Private item, Private item",
  );
  await mia.close();

  // In the app: the panel picks linked records from the other board.
  await db.board.update({ where: { id: delivery }, data: { projectId: null } });
  const review = await create(page, delivery, {
    name: "Design review",
    fieldValues: { [hours.id]: 2 },
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`/boards/${deals}?task=${checkout}`);
  const panel = page.getByRole("dialog");
  const picker = panel.getByRole("group", { name: "Delivery tasks" });
  await expect(picker).toContainText("Scope doc");
  await picker.getByRole("button", { name: "Link Delivery tasks" }).click();
  await page
    .getByLabel("Search records to link to Delivery tasks")
    .fill("design");
  await page.getByRole("option", { name: "Design review" }).click();
  await expect(picker).toContainText("Design review");
  await page.screenshot({ path: "../../artifacts/links/panel.png" });
  await panel
    .getByRole("button", { name: "Save changes", exact: true })
    .click();
  await expect
    .poll(() => db.recordLink.count({ where: { toId: review } }))
    .toBe(1);
  // Scope doc (5) + Design review (2); the archived kickoff isn't counted.
  expect((await dealRow()).fieldValues[totalHours.id]).toBe(7);

  // CSV writes linked names.
  const csv = await post(page, "/api/v1/boards/export", {
    boardId: deals,
    scope: "BOARD",
    includeArchived: false,
  });
  expect(await csv.text()).toContain("Kickoff call; Scope doc; Design review");

  // Removing the link field removes its mirror, links and rollups.
  const fresh = (await state(page, deals)).fields.find(
    (item: { id: string }) => item.id === link.id,
  );
  await ok(
    await post(page, "/api/v1/boards/remove-field", {
      boardId: deals,
      fieldId: link.id,
      version: fresh.version,
    }),
  );
  expect(await db.recordLink.count()).toBe(0);
  for (const id of [mirror.id, openTasks.id, totalHours.id])
    expect(
      (await db.boardColumn.findUniqueOrThrow({ where: { id } })).archivedAt,
    ).not.toBeNull();
});
