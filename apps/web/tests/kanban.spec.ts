import { test, expect, type Page } from "@playwright/test";
import { getDatabase } from "@yuzu/database";

process.env.DATABASE_URL = process.env.YUZU_E2E_DATABASE_URL;
const ORIGIN = "http://127.0.0.1:3100";

test.beforeEach(async () => {
  if (new URL(process.env.DATABASE_URL!).pathname !== "/yuzu_e2e")
    throw new Error("Refusing to reset a non-test database.");
  const db = getDatabase();
  await db.installationSettings.deleteMany();
  await db.accessEvent.deleteMany();
  await db.invitation.deleteMany();
  await db.setupClaim.deleteMany();
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

async function ownerBoard(page: Page) {
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
  // Boards made through the API get the default status lanes.
  const made = await post(page, "/api/v1/boards/create-board", {
    workspaceId: workspace.id,
    name: "Launch",
  });
  expect(made.status()).toBe(200);
  return db.board.findUniqueOrThrow({
    where: { id: (await made.json()).data.id },
  });
}

test("cards keep a manual order, move between lanes by keyboard and reject bad placements", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const board = await ownerBoard(page);
  const db = getDatabase();
  const task = async (name: string) => {
    const created = await post(page, "/api/v1/boards/create-task", {
      boardId: board.id,
      createKey: crypto.randomUUID(),
      name,
      statusId: "todo",
    });
    expect(created.status()).toBe(200);
    return (await created.json()).data.taskId as string;
  };
  const first = await task("First step");
  await task("Second step");
  const third = await task("Third step");

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`/boards/${board.id}`);
  const lane = (name: string) =>
    page
      .locator(".board-lane")
      .filter({ has: page.getByRole("heading", { name, exact: true }) });
  const titles = (name: string) =>
    lane(name).locator(".task-card-title").allTextContents();
  await expect
    .poll(() => titles("To do"))
    .toEqual(["First step", "Second step", "Third step"]);
  // New tasks join the end of the board.
  const positions = await db.task.findMany({
    where: { boardId: board.id },
    orderBy: { position: "asc" },
    select: { name: true },
  });
  expect(positions.map((row) => row.name)).toEqual([
    "First step",
    "Second step",
    "Third step",
  ]);

  // Drag the last card above the first one.
  await page
    .locator(`.task-card[data-task-id="${third}"]`)
    .dragTo(page.locator(`.task-card[data-task-id="${first}"]`), {
      steps: 12,
      targetPosition: { x: 40, y: 4 },
    });
  await expect
    .poll(() => titles("To do"))
    .toEqual(["Third step", "First step", "Second step"]);
  await expect(page.locator('[data-slot="board-notification"]')).toContainText(
    "Task moved",
  );
  await page.reload();
  await expect
    .poll(() => titles("To do"))
    .toEqual(["Third step", "First step", "Second step"]);

  // Keyboard: pick up with Space, move right a lane, drop with Space.
  await page
    .getByRole("button", { name: "Drag Second step", exact: true })
    .focus();
  await page.keyboard.press("Space");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Space");
  await expect(
    lane("In progress").getByRole("button", {
      name: "Second step",
      exact: true,
    }),
  ).toBeVisible();
  await expect
    .poll(
      async () =>
        (await db.task.findFirstOrThrow({ where: { name: "Second step" } }))
          .statusId,
    )
    .toBe("in_progress");

  // A task can't be placed next to itself or next to another board's task.
  const self = await post(page, "/api/v1/boards/reorder", {
    taskId: first,
    afterId: first,
    beforeId: null,
  });
  expect(self.status()).toBe(422);
  const elsewhere = await db.board.create({
    data: {
      name: "Elsewhere",
      workspaceId: board.workspaceId,
      createdById: board.createdById,
    },
  });
  const foreign = await post(page, "/api/v1/boards/create-task", {
    boardId: elsewhere.id,
    createKey: crypto.randomUUID(),
    name: "Foreign",
  });
  const foreignId = (await foreign.json()).data.taskId as string;
  const crossBoard = await post(page, "/api/v1/boards/reorder", {
    taskId: first,
    afterId: foreignId,
    beforeId: null,
  });
  expect(crossBoard.status()).toBe(409);
});
