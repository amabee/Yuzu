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

async function board(page: Page) {
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
  await db.installationSettings.update({
    where: { id: "installation" },
    data: { setupState: "READY", initialWorkspaceId: workspace.id },
  });
  const made = await post(page, "/api/v1/boards/create-board", {
    workspaceId: workspace.id,
    name: "Roadmap",
  });
  expect(made.status()).toBe(200);
  return (await made.json()).data.id as string;
}

// Window starts on a fixed day so bars land at known offsets.
const from = "2026-10-05";
const day = (offset: number) => {
  const date = new Date(`${from}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
};

test("timeline shows spans and markers, and edits dates by keyboard and pointer", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const boardId = await board(page);
  const db = getDatabase();
  const task = async (name: string, extra: Record<string, unknown>) => {
    const created = await post(page, "/api/v1/boards/create-task", {
      boardId,
      createKey: crypto.randomUUID(),
      name,
      ...extra,
    });
    expect(created.status()).toBe(200);
    return (await created.json()).data.taskId as string;
  };
  const dates = async (id: string) => {
    const row = await db.task.findUniqueOrThrow({ where: { id } });
    return [
      row.startDate?.toISOString().slice(0, 10) ?? null,
      row.dueDate?.toISOString().slice(0, 10) ?? null,
    ];
  };
  const build = await task("Build engine", {
    startDate: day(7),
    dueDate: day(10),
  });
  await task("Launch review", { dueDate: day(14) });
  await task("Shipped thing", {
    startDate: day(2),
    dueDate: day(3),
    statusId: "done",
  });
  const someday = await task("Someday idea", {});

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`/boards/${boardId}?layout=timeline&from=${from}`);
  await expect(
    page.getByRole("button", { name: "Timeline", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  const bar = (name: string) =>
    page.locator(".timeline-bar").filter({ hasText: name });
  await expect(bar("Build engine")).toHaveAttribute(
    "aria-label",
    /Build engine, October 12 to October 15/,
  );
  // One date only: a marker.
  await expect(bar("Launch review")).toHaveAttribute("data-marker", "true");
  await expect(bar("Shipped thing")).toHaveAttribute("data-done", "true");
  await expect(
    page
      .getByRole("region", { name: /Not scheduled/ })
      .getByRole("button", { name: /Someday idea/ }),
  ).toBeVisible();

  // Keyboard: Right moves, Shift+Right extends the due date,
  // Alt+Shift+Left pulls the start earlier. Saves after a pause.
  await bar("Build engine").focus();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Shift+ArrowRight");
  await page.keyboard.press("Alt+Shift+ArrowLeft");
  await expect.poll(() => dates(build)).toEqual([day(7), day(12)]);
  // Pointer: drag the middle two days later, then the end one day earlier.
  await expect(bar("Build engine")).not.toHaveAttribute(
    "data-dragging",
    "true",
  );
  await expect(
    bar("Build engine").locator('.timeline-handle[data-edge="end"]'),
  ).toBeVisible();
  // Keyboard focus can scroll the bar beneath the sticky task-name column.
  // Reset the viewport before using raw pointer coordinates.
  await page.locator(".timeline-scroll").evaluate((element) => {
    element.scrollTo({ left: 0, behavior: "instant" });
  });
  const width = 36;
  let box = (await bar("Build engine").boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    box.x + box.width / 2 + width * 2,
    box.y + box.height / 2,
    {
      steps: 8,
    },
  );
  await page.mouse.up();
  await expect.poll(() => dates(build)).toEqual([day(9), day(14)]);
  await expect(
    bar("Build engine").locator('.timeline-handle[data-edge="end"]'),
  ).toBeVisible();
  box = (await bar("Build engine").boundingBox())!;
  await page.mouse.move(box.x + box.width - 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 2 - width, box.y + box.height / 2, {
    steps: 6,
  });
  await page.mouse.up();
  await expect.poll(() => dates(build)).toEqual([day(9), day(13)]);

  // Drag an unscheduled task onto the timeline to give it that day.
  await expect(
    bar("Build engine").locator('.timeline-handle[data-edge="end"]'),
  ).toBeVisible();
  const chip = (await page
    .getByRole("region", { name: /Not scheduled/ })
    .getByRole("button", { name: /Someday idea/ })
    .boundingBox())!;
  const axis = (await page.locator(".timeline-axis").boundingBox())!;
  await page.mouse.move(chip.x + 10, chip.y + chip.height / 2);
  await page.mouse.down();
  await page.mouse.move(axis.x + width * 20 + 10, axis.y + 60, { steps: 10 });
  await page.mouse.up();
  await expect.poll(() => dates(someday)).toEqual([day(20), day(20)]);
});

test("timeline zoom and rows are saved with the view", async ({ page }) => {
  const boardId = await board(page);
  await post(page, "/api/v1/boards/create-task", {
    boardId,
    createKey: crypto.randomUUID(),
    name: "Spec",
    dueDate: day(3),
  });
  await page.goto(`/boards/${boardId}?layout=timeline&from=${from}`);
  await page.getByRole("button", { name: "Months", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Months", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.getByLabel("Timeline rows").selectOption("status");
  await expect(
    page.getByRole("region", { name: /To do, 1 task/ }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Save view" }).click();
  await page.getByLabel("View name").fill("Quarter plan");
  await page.getByRole("button", { name: "Save new view" }).click();
  await expect(page.locator("option", { hasText: "Quarter plan" })).toHaveCount(
    1,
  );
  const view = await getDatabase().savedBoardView.findFirstOrThrow({
    where: { name: "Quarter plan" },
  });
  expect(view.config).toMatchObject({
    layout: "timeline",
    timeline: { zoom: "months", groupBy: "status" },
  });
});
