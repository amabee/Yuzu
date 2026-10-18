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

test("protected changes become approval requests and repeated failures pause a rule", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const { owner, boardId } = await ownerBoard(page);
  const db = getDatabase();
  // A reviewer who can see the board, and a policy protecting priority.
  const reviewer = await db.user.create({
    data: {
      name: "Mia Reviewer",
      email: "mia@example.test",
      emailVerified: true,
    },
  });
  const board = await db.board.findUniqueOrThrow({
    where: { id: boardId },
    include: { columns: true },
  });
  await db.workspaceMember.create({
    data: { workspaceId: board.workspaceId, userId: reviewer.id },
  });
  const priority = board.columns.find((column) => column.key === "priority")!;
  await db.boardApprovalPolicy.create({
    data: {
      boardId,
      enabled: true,
      requireChanges: true,
      protectedFieldIds: [priority.id],
      primaryApproverId: reviewer.id,
    },
  });
  const save = (rule: Record<string, unknown>) =>
    post(page, "/api/v1/automations/save", { boardId, ...rule });
  expect(
    (
      await save({
        name: "Escalate done",
        trigger: { kind: "status.changed", from: null, to: "done" },
        actions: [{ kind: "set.priority", value: "URGENT" }],
      })
    ).status(),
  ).toBe(200);
  const task = async (name: string) =>
    (
      await (
        await post(page, "/api/v1/boards/create-task", {
          boardId,
          createKey: crypto.randomUUID(),
          name,
          statusId: "todo",
        })
      ).json()
    ).data.taskId as string;
  const guarded = await task("Guarded");
  await post(page, "/api/v1/boards/update", {
    taskId: guarded,
    revision: 1,
    requestKey: crypto.randomUUID(),
    changes: { statusId: "done" },
  });
  // The rule asks instead of changing the protected field.
  await expect
    .poll(
      () =>
        db.boardProposal.count({
          where: { taskId: guarded, authorId: owner.id, status: "PENDING" },
        }),
      { timeout: 20_000 },
    )
    .toBe(1);
  expect(
    (await db.task.findUniqueOrThrow({ where: { id: guarded } })).priority,
  ).toBe("NORMAL");
  expect(
    (await db.automationRun.findFirstOrThrow({ where: { taskId: guarded } }))
      .outcome,
  ).toBe("PENDING_APPROVAL");

  // A rule whose option disappears fails, then pauses after five in a row.
  const field = await post(page, "/api/v1/boards/field", {
    boardId,
    name: "Stage",
    type: "SINGLE_SELECT",
    options: ["Ready"],
  });
  expect(field.status()).toBe(200);
  const stage = await db.boardColumn.findFirstOrThrow({
    where: { boardId, name: "Stage" },
  });
  const ready = (stage.config as { options: { id?: string; label: string }[] })
    .options[0]!;
  const staging = await save({
    name: "Stage new work",
    trigger: { kind: "task.created" },
    actions: [
      { kind: "set.field", fieldId: stage.id, value: ready.id ?? ready.label },
    ],
  });
  expect(staging.status()).toBe(200);
  await db.boardColumn.update({
    where: { id: stage.id },
    data: { config: { options: [{ id: "later", label: "Later" }] } },
  });
  for (let index = 0; index < 5; index++) await task(`Broken ${index}`);
  const ruleId = (await staging.json()).data.id as string;
  await expect
    .poll(
      async () => {
        const rule = await db.automationRule.findUniqueOrThrow({
          where: { id: ruleId },
        });
        return [rule.enabled, rule.consecutiveFailures];
      },
      { timeout: 30_000 },
    )
    .toEqual([false, 5]);
  expect(
    await db.notification.count({
      where: { recipientId: owner.id, kind: "AUTOMATION" },
    }),
  ).toBe(1);
});

test("managers build, edit, switch off, inspect and remove rules from the board", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const { boardId } = await ownerBoard(page);
  const db = getDatabase();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`/boards/${boardId}`);
  await page.getByRole("button", { name: "Automations", exact: true }).click();
  const sheet = page.getByRole("dialog", { name: "Automations" });
  await expect(
    sheet.getByText("No rules yet.", { exact: false }),
  ).toBeVisible();

  // Start from a template, rename it and add a condition.
  await sheet
    .getByRole("button", { name: "Notify on completion", exact: true })
    .click();
  const builder = page.getByRole("dialog", { name: "New rule" });
  await expect(builder.getByLabel("Rule name")).toHaveValue(
    "Notify on completion",
  );
  await builder.getByLabel("Rule name").fill("Ship it");
  await builder.getByRole("button", { name: "Add condition" }).click();
  await builder
    .getByLabel("Condition 1 value", { exact: true })
    .selectOption("HIGH");
  await builder.getByRole("button", { name: "Add action" }).click();
  await builder
    .getByLabel("Action 2", { exact: true })
    .selectOption("set.priority");
  await builder.getByLabel("Action 2 value").selectOption("URGENT");
  await expect(builder.locator(".automation-preview")).toHaveText(
    "When status changes to Done, if priority is High, then notify the creator and set priority to Urgent.",
  );
  await page.screenshot({
    path: "../../artifacts/automation/builder.png",
  });
  await builder.getByRole("button", { name: "Save rule" }).click();
  await expect(builder).toHaveCount(0);
  await expect(sheet.locator(".automation-rule")).toContainText("Ship it");

  // The rule runs when a matching task is finished.
  const created = await post(page, "/api/v1/boards/create-task", {
    boardId,
    createKey: crypto.randomUUID(),
    name: "Hot task",
    priority: "HIGH",
    statusId: "todo",
  });
  const taskId = (await created.json()).data.taskId as string;
  await post(page, "/api/v1/boards/update", {
    taskId,
    revision: 1,
    requestKey: crypto.randomUUID(),
    changes: { statusId: "done" },
  });
  await expect
    .poll(
      async () =>
        (await db.task.findUniqueOrThrow({ where: { id: taskId } })).priority,
      { timeout: 20_000 },
    )
    .toBe("URGENT");
  await sheet.getByRole("button", { name: "Runs for Ship it" }).click();
  const runs = page.getByRole("dialog", { name: "Ship it: runs" });
  await expect(runs.locator(".automation-runs li")).toHaveCount(1, {
    timeout: 20_000,
  });
  await expect(runs.locator(".automation-runs li")).toContainText("Hot task");
  await expect(runs.locator(".automation-outcome")).toHaveText("Applied");
  await page.screenshot({ path: "../../artifacts/automation/runs.png" });
  await runs.getByRole("button", { name: "Done", exact: true }).click();

  // Switch it off, then remove it.
  await sheet.getByRole("switch", { name: "Turn off Ship it" }).click();
  await expect(
    sheet.getByRole("switch", { name: "Turn on Ship it" }),
  ).toBeVisible();
  await page.screenshot({ path: "../../artifacts/automation/rules.png" });
  await sheet.getByRole("button", { name: "Remove Ship it" }).click();
  await page.getByRole("button", { name: "Remove rule", exact: true }).click();
  await expect(sheet.locator(".automation-rule")).toHaveCount(0);
  await expect
    .poll(() => db.automationRule.count({ where: { boardId } }))
    .toBe(0);
  await expect(sheet).toBeVisible();
});

test("slice 2: hand-offs to other boards, comments, checklists and any-matching", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const { boardId } = await ownerBoard(page);
  const db = getDatabase();
  const board = await db.board.findUniqueOrThrow({ where: { id: boardId } });
  const qa = await post(page, "/api/v1/boards/create-board", {
    workspaceId: board.workspaceId,
    name: "QA",
  });
  const qaId = (await qa.json()).data.id as string;
  const save = (rule: Record<string, unknown>) =>
    post(page, "/api/v1/automations/save", { boardId, ...rule });
  // Done tasks of high or urgent priority get a QA task on the other board.
  const handoff = await save({
    name: "Hand off to QA",
    trigger: { kind: "status.changed", from: null, to: "done" },
    match: "any",
    conditions: [
      { subject: "priority", op: "is", value: "HIGH" },
      { subject: "priority", op: "is", value: "URGENT" },
    ],
    actions: [
      {
        kind: "create.task",
        boardId: qaId,
        name: "QA: {task}",
        statusId: "todo",
        dueInDays: 2,
      },
    ],
  });
  expect(handoff.status()).toBe(200);
  expect(
    (
      await save({
        name: "Comment bumps priority",
        trigger: { kind: "comment.added", mentionsOnly: false },
        actions: [{ kind: "set.priority", value: "HIGH" }],
      })
    ).status(),
  ).toBe(200);
  expect(
    (
      await save({
        name: "Checklist done means done",
        trigger: { kind: "checklist.completed" },
        actions: [{ kind: "set.status", value: "done" }],
      })
    ).status(),
  ).toBe(200);

  const created = await post(page, "/api/v1/boards/create-task", {
    boardId,
    createKey: crypto.randomUUID(),
    name: "Checkout redesign",
    statusId: "in_progress",
    checklist: [{ id: crypto.randomUUID(), text: "Build it", done: false }],
  });
  const taskId = (await created.json()).data.taskId as string;
  // A comment raises priority; finishing the checklist then completes the
  // task, which hands it off to QA.
  expect(
    (
      await post(page, "/api/v1/boards/comment", {
        taskId,
        createKey: crypto.randomUUID(),
        body: "Ready for a look",
      })
    ).status(),
  ).toBe(200);
  await expect
    .poll(
      async () =>
        (await db.task.findUniqueOrThrow({ where: { id: taskId } })).priority,
      { timeout: 20_000 },
    )
    .toBe("HIGH");
  const current = await db.task.findUniqueOrThrow({ where: { id: taskId } });
  const checklist = current.checklist as {
    id: string;
    text: string;
    done: boolean;
  }[];
  expect(
    (
      await post(page, "/api/v1/boards/update", {
        taskId,
        revision: current.revision,
        requestKey: crypto.randomUUID(),
        changes: {
          checklist: checklist.map((item) => ({ ...item, done: true })),
        },
      })
    ).status(),
  ).toBe(200);
  await expect
    .poll(
      async () =>
        (
          await db.task.findMany({
            where: { boardId: qaId },
            select: { name: true, statusId: true },
          })
        ).map((task) => `${task.name} (${task.statusId})`),
      { timeout: 20_000 },
    )
    .toEqual(["QA: Checkout redesign (todo)"]);
  expect(
    (await db.task.findUniqueOrThrow({ where: { id: taskId } })).statusId,
  ).toBe("done");
  const runs = await (
    await page.request.get(
      `/api/v1/automations/runs?ruleId=${(await handoff.json()).data.id}`,
    )
  ).json();
  expect(runs.data.runs[0].createdTask.name).toBe("QA: Checkout redesign");
  expect(runs.data.runs[0].createdTask.boardId).toBe(qaId);
});

test("slice 2: schedules run once, missed runs catch up once, and webhooks are signed", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const { boardId } = await ownerBoard(page);
  const db = getDatabase();
  const settings = await db.installationSettings.findUniqueOrThrow({
    where: { id: "installation" },
  });
  const local = (date: Date) =>
    new Intl.DateTimeFormat("en-GB", {
      timeZone: settings.timezone,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).format(date);

  // A local receiver that records what it was sent.
  const received: { body: string; signature: string }[] = [];
  const { createServer } = await import("node:http");
  const server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => (body += chunk));
    request.on("end", () => {
      received.push({
        body,
        signature: String(request.headers["x-yuzu-signature"]),
      });
      response.writeHead(204).end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  try {
    const save = (rule: Record<string, unknown>) =>
      post(page, "/api/v1/automations/save", { boardId, ...rule });
    const schedule = {
      kind: "schedule",
      schedule: {
        every: "day",
        time: local(new Date(Date.now() - 3 * 3_600_000)),
      },
    };
    // Local addresses are refused until an admin allows them.
    const refused = await save({
      name: "Report",
      trigger: schedule,
      actions: [{ kind: "webhook", url: `http://127.0.0.1:${port}/hook` }],
    });
    expect(refused.status()).toBe(422);
    expect((await refused.json()).error.code).toBe("PRIVATE_WEBHOOK");
    await db.installationSettings.update({
      where: { id: "installation" },
      data: { allowPrivateWebhooks: true },
    });
    // Scheduled rules have no task to change.
    expect(
      (
        await save({
          name: "Broken",
          trigger: schedule,
          actions: [{ kind: "set.priority", value: "HIGH" }],
        })
      ).status(),
    ).toBe(422);
    const report = await save({
      name: "Daily report",
      trigger: schedule,
      actions: [
        {
          kind: "create.task",
          boardId: null,
          name: "Report for {date}",
          assigneeIds: [],
        },
        { kind: "webhook", url: `http://127.0.0.1:${port}/hook` },
      ],
    });
    expect(report.status()).toBe(200);
    const saved = (await report.json()).data;
    expect(saved.webhookSecret).toMatch(/^whsec_/);
    // Pretend Yuzu was off at the scheduled time: it runs once on return.
    await db.automationRule.update({
      where: { id: saved.id },
      data: { lastScheduledAt: new Date(Date.now() - 2 * 86_400_000) },
    });
    await expect
      .poll(
        () =>
          db.task.count({
            where: { boardId, name: { startsWith: "Report for " } },
          }),
        { timeout: 20_000 },
      )
      .toBe(1);
    await expect.poll(() => received.length, { timeout: 20_000 }).toBe(1);
    // The signature verifies with the secret shown on save.
    const { createHmac } = await import("node:crypto");
    const [t, v1] = received[0]!.signature
      .split(",")
      .map((part) => part.split("=")[1]);
    expect(
      createHmac("sha256", saved.webhookSecret)
        .update(`${t}.${received[0]!.body}`)
        .digest("hex"),
    ).toBe(v1);
    expect(JSON.parse(received[0]!.body)).toMatchObject({
      event: "schedule",
      rule: { name: "Daily report" },
    });
    const runs = await (
      await page.request.get(`/api/v1/automations/runs?ruleId=${saved.id}`)
    ).json();
    expect(runs.data.runs).toHaveLength(1);
    expect(runs.data.runs[0]).toMatchObject({
      taskId: null,
      missed: true,
      outcome: "APPLIED",
    });
    await expect
      .poll(async () => {
        const fresh = await (
          await page.request.get(`/api/v1/automations/runs?ruleId=${saved.id}`)
        ).json();
        return fresh.data.runs[0].deliveries[0]?.status;
      })
      .toBe("DELIVERED");
    // More worker ticks do not run it again.
    await page.waitForTimeout(5_000);
    expect(
      await db.task.count({
        where: { boardId, name: { startsWith: "Report for " } },
      }),
    ).toBe(1);
    expect(received).toHaveLength(1);
  } finally {
    server.close();
  }
});
