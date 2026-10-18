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
  const made = await post(page, "/api/v1/boards/create-board", {
    workspaceId: workspace.id,
    name: "Launch",
  });
  expect(made.status()).toBe(200);
  return { owner, boardId: (await made.json()).data.id as string };
}

test("rules apply as their creator, chain, notify, explain skips and reject bad references", async ({
  page,
  browser,
}) => {
  test.setTimeout(90_000);
  const { owner, boardId } = await ownerBoard(page);
  const db = getDatabase();
  const save = (rule: Record<string, unknown>) =>
    post(page, "/api/v1/automations/save", { boardId, ...rule });

  // When a task is done and high priority, escalate it and tell its creator.
  const escalate = await save({
    name: "Escalate done",
    trigger: { kind: "status.changed", from: null, to: "done" },
    conditions: [{ subject: "priority", op: "is", value: "HIGH" }],
    actions: [
      { kind: "set.priority", value: "URGENT" },
      { kind: "notify", to: "creator" },
    ],
  });
  expect(escalate.status()).toBe(200);
  // A second rule reacts to the first rule's change (one step down the chain).
  expect(
    (
      await save({
        name: "Urgent gets a date",
        trigger: { kind: "field.changed", field: "priority", value: "URGENT" },
        actions: [{ kind: "set.date", field: "dueDate", days: 2 }],
      })
    ).status(),
  ).toBe(200);

  // References are checked against the board.
  const bad = await save({
    name: "Broken",
    trigger: { kind: "status.changed", from: null, to: "shipped" },
    actions: [{ kind: "notify", to: "creator" }],
  });
  expect(bad.status()).toBe(422);
  expect((await bad.json()).error.message).toContain("status");

  const task = async (name: string, priority: string) => {
    const created = await post(page, "/api/v1/boards/create-task", {
      boardId,
      createKey: crypto.randomUUID(),
      name,
      priority,
      statusId: "todo",
    });
    expect(created.status()).toBe(200);
    return (await created.json()).data.taskId as string;
  };
  const finish = async (taskId: string) =>
    expect(
      (
        await post(page, "/api/v1/boards/update", {
          taskId,
          revision: 1,
          requestKey: crypto.randomUUID(),
          changes: { statusId: "done" },
        })
      ).status(),
    ).toBe(200);

  const hot = await task("Launch post", "HIGH");
  const calm = await task("Tidy docs", "NORMAL");
  await finish(hot);
  await finish(calm);

  const settings = await db.installationSettings.findUniqueOrThrow({
    where: { id: "installation" },
  });
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: settings.timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const inTwoDays = new Date(`${today}T00:00:00Z`);
  inTwoDays.setUTCDate(inTwoDays.getUTCDate() + 2);

  await expect
    .poll(
      async () => {
        const row = await db.task.findUniqueOrThrow({ where: { id: hot } });
        return [row.priority, row.dueDate?.toISOString().slice(0, 10)];
      },
      { timeout: 20_000 },
    )
    .toEqual(["URGENT", inTwoDays.toISOString().slice(0, 10)]);

  // Changes are recorded as the rule, acting as its creator.
  const activity = await db.taskActivity.findMany({
    where: { taskId: hot },
    orderBy: { revision: "asc" },
  });
  expect(activity.map((row) => row.action)).toEqual([
    "Created task",
    "Updated task",
    "Automation · Escalate done",
    "Automation · Urgent gets a date",
  ]);
  expect(activity.at(-1)!.actorId).toBe(owner.id);

  // The creator is notified even though the rule acts as them.
  await expect
    .poll(() =>
      db.notification.count({
        where: { recipientId: owner.id, kind: "AUTOMATION", taskId: hot },
      }),
    )
    .toBe(1);

  // The calm task doesn't match, and the run history says why.
  const escalateId = (await escalate.json()).data.id as string;
  await expect
    .poll(async () => {
      const runs = await (
        await page.request.get(`/api/v1/automations/runs?ruleId=${escalateId}`)
      ).json();
      return runs.data.runs
        .map(
          (run: { taskName: string; outcome: string; detail: string }) =>
            `${run.taskName}: ${run.outcome}${run.outcome === "SKIPPED" ? ` (${run.detail})` : ""}`,
        )
        .sort();
    })
    .toEqual([
      "Launch post: APPLIED",
      "Tidy docs: SKIPPED (Conditions didn't match.)",
    ]);

  // The rules list carries stats for the board's managers.
  const list = await (
    await page.request.get(`/api/v1/automations/list?boardId=${boardId}`)
  ).json();
  expect(
    list.data.rules.map((rule: { name: string; runCount: number }) => [
      rule.name,
      rule.runCount,
    ]),
  ).toEqual([
    ["Escalate done", 2],
    ["Urgent gets a date", 1],
  ]);

  // Turning a rule off stops it; signed-out visitors can't read rules.
  const rule = list.data.rules[0];
  expect(
    (
      await post(page, "/api/v1/automations/toggle", {
        id: rule.id,
        revision: rule.revision,
        enabled: false,
      })
    ).status(),
  ).toBe(200);
  const stale = await post(page, "/api/v1/automations/toggle", {
    id: rule.id,
    revision: rule.revision,
    enabled: true,
  });
  expect(stale.status()).toBe(409);
  const anonymous = await browser.newContext();
  expect(
    (
      await anonymous.request.get(
        `${ORIGIN}/api/v1/automations/list?boardId=${boardId}`,
      )
    ).status(),
  ).toBe(401);
  await anonymous.close();
});

test("rules that undo each other stop instead of looping", async ({ page }) => {
  test.setTimeout(90_000);
  const { boardId } = await ownerBoard(page);
  const db = getDatabase();
  const save = (rule: Record<string, unknown>) =>
    post(page, "/api/v1/automations/save", { boardId, ...rule });
  const calm = await save({
    name: "Calm down",
    trigger: { kind: "field.changed", field: "priority", value: "URGENT" },
    actions: [{ kind: "set.priority", value: "HIGH" }],
  });
  const panic = await save({
    name: "Panic",
    trigger: { kind: "field.changed", field: "priority", value: "HIGH" },
    actions: [{ kind: "set.priority", value: "URGENT" }],
  });
  expect(calm.status()).toBe(200);
  expect(panic.status()).toBe(200);
  const created = await post(page, "/api/v1/boards/create-task", {
    boardId,
    createKey: crypto.randomUUID(),
    name: "Ping pong",
  });
  const taskId = (await created.json()).data.taskId as string;
  await post(page, "/api/v1/boards/update", {
    taskId,
    revision: 1,
    requestKey: crypto.randomUUID(),
    changes: { priority: "URGENT" },
  });
  // Person → Calm (HIGH) → Panic (URGENT) → Calm again is stopped.
  await expect
    .poll(
      async () =>
        (
          await db.automationRun.findMany({
            where: { taskId },
            include: { rule: { select: { name: true } } },
            orderBy: { createdAt: "asc" },
          })
        ).map((run) => `${run.rule.name}: ${run.outcome}`),
      { timeout: 20_000 },
    )
    .toEqual(["Calm down: APPLIED", "Panic: APPLIED", "Calm down: SKIPPED"]);
  const stopped = await db.automationRun.findFirstOrThrow({
    where: { taskId, outcome: "SKIPPED" },
  });
  expect(stopped.detail).toBe(
    "Stopped: this rule had already run in this chain.",
  );
  expect(
    (await db.task.findUniqueOrThrow({ where: { id: taskId } })).priority,
  ).toBe("URGENT");
  // Nothing is left waiting in the queue.
  await expect
    .poll(() =>
      db.automationEvent.count({ where: { taskId, processedAt: null } }),
    )
    .toBe(0);
});
