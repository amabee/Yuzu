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
  const board = await db.board.create({
    data: { name: "Launch", workspaceId: workspace.id, createdById: owner.id },
  });
  await db.installationSettings.update({
    where: { id: "installation" },
    data: {
      setupState: "READY",
      initialWorkspaceId: workspace.id,
      initialBoardId: board.id,
    },
  });
  return board;
}

// Calendar days in the installation timezone (UTC in tests).
const day = (offset: number) => {
  const date = new Date();
  date.setUTCDate(15 + offset);
  return date.toISOString().slice(0, 10);
};
const label = (date: string) =>
  new Intl.DateTimeFormat("en", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  }).format(new Date(`${date}T00:00:00Z`));

test("calendar places, moves, creates and dims tasks by due date", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const board = await ownerBoard(page);
  const db = getDatabase();
  const task = async (
    name: string,
    dueDate: string | null,
    statusId?: string,
  ) => {
    const created = await post(page, "/api/v1/boards/create-task", {
      boardId: board.id,
      createKey: crypto.randomUUID(),
      name,
    });
    expect(created.status()).toBe(200);
    const id = (await created.json()).data.taskId as string;
    await db.task.update({
      where: { id },
      data: {
        dueDate: dueDate ? new Date(`${dueDate}T00:00:00Z`) : null,
        ...(statusId ? { statusId } : {}),
      },
    });
    return id;
  };
  const moving = await task("Write launch post", day(0));
  await task("Book venue", day(0), "done");
  for (const name of ["One", "Two", "Three", "Four"]) await task(name, day(3));
  await task("Someday idea", null);

  await page.setViewportSize({ width: 1440, height: 1100 });
  const month = day(0).slice(0, 7);
  await page.goto(`/boards/${board.id}?layout=calendar&month=${month}`);
  await expect(
    page.getByRole("button", { name: "Calendar", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  const cell = (date: string) =>
    page.getByRole("region", { name: label(date) });
  await expect(
    cell(day(0)).getByRole("button", { name: /Write launch post/ }),
  ).toBeVisible();
  // Done tasks stay visible but dimmed.
  await expect(
    cell(day(0)).getByRole("button", { name: /Book venue/ }),
  ).toHaveAttribute("data-done", "true");
  // Busy days show three chips and the rest behind "+N more".
  await expect(
    cell(day(3)).getByRole("button", { name: "+1 more" }),
  ).toBeVisible();
  await cell(day(3)).getByRole("button", { name: "+1 more" }).click();
  await expect(
    page
      .getByRole("dialog", { name: `Tasks on ${label(day(3))}` })
      .getByRole("button", { name: /Four/ }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(
    page
      .getByRole("region", { name: "No due date" })
      .getByRole("button", { name: /Someday idea/ }),
  ).toBeVisible();

  // Keyboard move: Space, Right, Enter moves the task one day later.
  await cell(day(0))
    .getByRole("button", { name: /Write launch post/ })
    .focus();
  await page.keyboard.press("Space");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Enter");
  await expect(
    cell(day(1)).getByRole("button", { name: /Write launch post/ }),
  ).toBeVisible();
  await expect
    .poll(async () =>
      (await db.task.findUniqueOrThrow({ where: { id: moving } })).dueDate
        ?.toISOString()
        .slice(0, 10),
    )
    .toBe(day(1));

  // Drag to "No due date" clears the date.
  // Wait for the previous save to settle; moves made during a save are ignored.
  await expect(
    cell(day(1)).getByRole("button", { name: /Write launch post/ }),
  ).toHaveAttribute("draggable", "true");
  // Move in steps like a person would; Chromium starts a native drag only
  // after the pointer travels while pressed.
  const source = await cell(day(1))
    .getByRole("button", { name: /Write launch post/ })
    .boundingBox();
  const target = await page
    .getByRole("region", { name: "No due date" })
    .boundingBox();
  await page.mouse.move(source!.x + 10, source!.y + source!.height / 2);
  await page.mouse.down();
  await page.mouse.move(target!.x + 20, target!.y + 20, { steps: 12 });
  await page.mouse.up();
  await expect
    .poll(
      async () =>
        (await db.task.findUniqueOrThrow({ where: { id: moving } })).dueDate,
    )
    .toBeNull();

  // "+" on a day opens the task form with that date.
  await cell(day(5)).hover();
  await page
    .getByRole("button", { name: `Add task on ${label(day(5))}` })
    .click();
  await expect(page.getByLabel("Task due date")).toHaveValue(day(5));
  await page.getByLabel("Task name").fill("Rehearsal");
  await page
    .getByRole("button", { name: "Create task", exact: true })
    .last()
    .click();
  await expect(
    cell(day(5)).getByRole("button", { name: /Rehearsal/ }),
  ).toBeVisible();

  // The due-date filter is hidden on the calendar.
  await page.getByRole("button", { name: "Filter", exact: true }).click();
  await expect(page.getByLabel("Filter task due date")).toHaveCount(0);
});

test("owners choose the week start for every calendar", async ({ page }) => {
  const board = await ownerBoard(page);
  await page.goto(`/boards/${board.id}?layout=calendar`);
  const firstWeekday = page.locator(".calendar-weekday").first();
  await expect(firstWeekday).toHaveText("Mon");
  await page.goto("/settings");
  await page.getByLabel("Weeks start on").selectOption("0");
  await expect(
    page.getByText("Saved. Calendars use the new week start."),
  ).toBeVisible();
  await page.goto(`/boards/${board.id}?layout=calendar`);
  await expect(firstWeekday).toHaveText("Sun");
});
