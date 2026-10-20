import { test, expect, type Page } from "@playwright/test";
import { getDatabase } from "@yuzu/database";
import { startTestCsvWorker, stopTestCsvWorker } from "./csv-worker-process";

process.env.DATABASE_URL = process.env.YUZU_E2E_DATABASE_URL;
const ORIGIN = "http://127.0.0.1:3100";

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

async function owner(page: Page) {
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
  const user = await db.user.findUniqueOrThrow({
    where: { email: "owner@example.test" },
  });
  const workspace = await db.workspace.create({
    data: {
      name: "Our team",
      createdById: user.id,
      members: { create: { userId: user.id } },
    },
  });
  const seed = await db.board.create({
    data: { name: "Start", workspaceId: workspace.id, createdById: user.id },
  });
  await db.installationSettings.update({
    where: { id: "installation" },
    data: {
      setupState: "READY",
      initialWorkspaceId: workspace.id,
      initialBoardId: seed.id,
    },
  });
  return { user, workspace };
}

const create = (page: Page, boardId: string, data: Record<string, unknown>) =>
  post(page, "/api/v1/boards/create-task", {
    boardId,
    createKey: crypto.randomUUID(),
    ...data,
  });

test("deal boards hold deals: their names, locked fields, money and rules", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const { user } = await owner(page);
  const db = getDatabase();
  await page.setViewportSize({ width: 1440, height: 1000 });

  await page.goto("/boards");
  await page.getByRole("button", { name: "Create board" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("radio", { name: /Deals/ }).click();
  await expect(dialog).toContainText("Lead → Qualified → Proposal");
  await dialog.getByLabel("Board name").fill("Deals");
  await dialog.getByRole("button", { name: "Create board" }).click();
  await page.waitForURL(/\/boards\/[0-9a-f-]+/);
  const boardId = page.url().split("/boards/")[1]!.split(/[?#]/)[0]!;
  const board = await db.board.findUniqueOrThrow({
    where: { id: boardId },
    include: { columns: true, groups: true },
  });
  expect(board.recordType).toBe("DEAL");
  expect(board.groups.map((group) => group.name)).toEqual(["Deals"]);
  const amount = board.columns.find((column) => column.key === "amount")!;
  const probability = board.columns.find(
    (column) => column.key === "probability",
  )!;

  // The server knows what a deal is.
  const rejected = async (data: Record<string, unknown>, code: string) => {
    const response = await create(page, boardId, { name: "Bad", ...data });
    expect(response.status(), code).toBe(422);
    expect((await response.json()).error.code).toBe(code);
  };
  await rejected({ priority: "URGENT" }, "FIELD_TURNED_OFF");
  await rejected({ startDate: "2026-11-01" }, "FIELD_TURNED_OFF");
  const second = await db.user.create({
    data: { name: "Rae Kim", email: "rae@example.test", emailVerified: true },
  });
  await rejected({ assigneeIds: [user.id, second.id] }, "TOO_MANY_ASSIGNEES");
  expect(
    (
      await create(page, boardId, {
        name: "Bad",
        fieldValues: { [amount.id]: -5 },
      })
    ).status(),
  ).toBe(422);
  expect(
    (
      await create(page, boardId, {
        name: "Bad",
        fieldValues: { [probability.id]: 140 },
      })
    ).status(),
  ).toBe(422);
  const removeAmount = await post(page, "/api/v1/boards/remove-field", {
    boardId,
    fieldId: amount.id,
    version: "0".repeat(64),
  });
  expect(removeAmount.status()).toBe(422);
  expect(await db.task.count({ where: { boardId } })).toBe(0);

  // Adding a deal in the app: Owner and Close date, no Priority.
  await page
    .getByRole("button", { name: "Add deal", exact: true })
    .first()
    .click();
  const panel = page.getByRole("dialog");
  await panel
    .getByLabel("Deal name", { exact: true })
    .fill("Checkout redesign");
  await expect(panel.getByLabel("Deal priority")).toHaveCount(0);
  await expect(panel.getByText("Owner", { exact: true })).toBeVisible();
  await panel.getByLabel("Deal close date", { exact: true }).fill("2026-11-28");
  await panel.getByLabel("Amount", { exact: true }).fill("16400");
  await panel.getByLabel("Probability", { exact: true }).fill("60");
  await panel.getByRole("button", { name: "Create deal", exact: true }).click();
  await expect(panel).toHaveCount(0);
  const card = page
    .locator(".task-card")
    .filter({ hasText: "Checkout redesign" });
  await expect(card).toContainText("₱16,400.00");
  await page.screenshot({ path: "../../artifacts/records/deal-kanban.png" });

  await page.getByRole("button", { name: "Table", exact: true }).click();
  const headers = page.locator("thead th");
  await expect(headers).toContainText([
    "Deal",
    "Stage",
    "Owner",
    "Close date",
    "Amount",
    "Probability",
  ]);
  await expect(page.locator("thead")).not.toContainText("Priority");
  await expect(page.locator("tbody")).toContainText("60%");
  await expect(
    page.getByRole("status").filter({ hasText: "of 1 deal" }),
  ).toBeVisible();

  // CSV, search and the dashboard follow the type.
  const csv = await post(page, "/api/v1/boards/export", {
    boardId,
    scope: "BOARD",
    includeArchived: false,
  });
  expect(csv.status()).toBe(200);
  const header = (await csv.text()).split("\r\n")[0]!;
  expect(header).toContain('"Deal ID","Deal","Description","Stage"');
  expect(header).not.toContain("Priority");
  expect(header).toContain('"Close date","Group","Owner","Owner IDs"');
  const search = await (
    await page.request.get("/api/v1/search/tasks?q=checkout")
  ).json();
  expect(search.data.tasks[0].recordName).toBe("Deal");
  const dashboard = await (await page.request.get("/api/v1/dashboard")).json();
  expect(dashboard.data.total).toBe(0);

  // Rule builder offers only what deals have.
  await page.getByRole("button", { name: "Automations", exact: true }).click();
  await page.getByRole("button", { name: "New rule", exact: true }).click();
  const builder = page.getByRole("dialog", { name: "New rule" });
  const triggers = builder.getByLabel("Trigger", { exact: true });
  await expect(
    triggers.locator("option", { hasText: "priority changes" }),
  ).toHaveCount(0);
  await expect(
    triggers.locator("option", { hasText: "status changes" }),
  ).toHaveCount(1);
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");

  // Currency comes from settings.
  await page.goto("/settings");
  await page.getByLabel("Currency").selectOption("USD");
  await expect(page.getByText("Saved. Currency fields use it")).toBeVisible();
  await page.goto(`/boards/${boardId}`);
  await expect(
    page.locator(".task-card").filter({ hasText: "Checkout redesign" }),
  ).toContainText("$16,400.00");
});

test("custom boards name their records and turn fields off safely", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const { workspace } = await owner(page);
  const db = getDatabase();
  await page.setViewportSize({ width: 1440, height: 1000 });
  const made = await post(page, "/api/v1/boards/create-board", {
    workspaceId: workspace.id,
    name: "Hiring",
    recordType: "CUSTOM",
    record: {
      singular: "Candidate",
      plural: "Candidates",
      builtins: { priority: { on: false } },
    },
  });
  expect(made.status()).toBe(200);
  const boardId = (await made.json()).data.id as string;
  // A rule that sets the status, before Status is turned off.
  expect(
    (
      await post(page, "/api/v1/automations/save", {
        boardId,
        name: "Start screening",
        trigger: { kind: "task.created" },
        actions: [{ kind: "set.status", value: "in_progress" }],
      })
    ).status(),
  ).toBe(200);

  await page.goto(`/boards/${boardId}`);
  await expect(
    page.getByRole("button", { name: "Add candidate", exact: true }).first(),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Board details", exact: true })
    .click();
  const settings = page.getByRole("region", { name: "Records on this board" });
  await expect(settings.getByLabel("One record is a")).toHaveValue("Candidate");
  await expect(
    settings.getByRole("switch", { name: "Priority" }),
  ).not.toBeChecked();
  await settings.getByRole("switch", { name: "Status" }).click();
  await settings.getByRole("button", { name: "Save" }).click();
  await expect(settings.getByRole("alert")).toContainText("Start screening");
  await page.screenshot({ path: "../../artifacts/records/turn-off.png" });
  await settings.getByRole("button", { name: "Turn off anyway" }).click();
  await expect
    .poll(async () => {
      const board = await db.board.findUniqueOrThrow({
        where: { id: boardId },
      });
      return (
        board.recordConfig as { builtins?: { status?: { on?: boolean } } }
      ).builtins?.status?.on;
    })
    .toBe(false);
  await page.keyboard.press("Escape");
  await expect(
    page.getByText("The Kanban view groups candidates by Status"),
  ).toBeVisible();

  // The rule now skips with a clear reason instead of failing.
  const created = await create(page, boardId, { name: "Ana Reyes" });
  expect(created.status()).toBe(200);
  await expect
    .poll(
      async () =>
        (await db.automationRun.findFirst({ where: { rule: { boardId } } }))
          ?.detail,
      { timeout: 30_000 },
    )
    .toBe("Uses Status, which is turned off on this board.");
  const rule = await db.automationRule.findFirstOrThrow({ where: { boardId } });
  expect(rule.enabled).toBe(true);
  expect(rule.consecutiveFailures).toBe(0);
  expect(
    (await db.task.findFirstOrThrow({ where: { boardId } })).statusId,
  ).toBeNull();
});
