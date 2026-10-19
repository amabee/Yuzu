import { test as base, expect, type Page } from "@playwright/test";
import { SMTPServer } from "smtp-server";
import { getDatabase } from "@yuzu/database";
import { encryptSettings } from "../src/server/setup/security";
import { startTestCsvWorker, stopTestCsvWorker } from "./csv-worker-process";

process.env.DATABASE_URL = process.env.YUZU_E2E_DATABASE_URL;
process.env.SETTINGS_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64url");
const ORIGIN = "http://127.0.0.1:3100";

/** Raw messages the fake mail server received, decoded enough to search. */
const test = base.extend<{ mailbox: string[] }>({
  mailbox: async ({}, provide) => {
    const messages: string[] = [];
    const server = new SMTPServer({
      authOptional: true,
      disabledCommands: ["STARTTLS", "AUTH"],
      onData(stream, _session, callback) {
        let body = "";
        stream.on("data", (chunk) => (body += chunk.toString()));
        stream.on("end", () => {
          // Undo quoted-printable soft breaks and escapes.
          messages.push(
            body
              .replace(/=\r?\n/g, "")
              .replace(/=([0-9A-F]{2})/g, (_, hex: string) =>
                String.fromCharCode(parseInt(hex, 16)),
              ),
          );
          callback();
        });
      },
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(25250, "127.0.0.1", resolve);
    });
    await provide(messages);
    await new Promise<void>((resolve) => server.close(resolve));
  },
});

test.beforeAll(() => startTestCsvWorker());
test.afterAll(() => stopTestCsvWorker());
test.beforeEach(async () => {
  if (new URL(process.env.DATABASE_URL!).pathname !== "/yuzu_e2e")
    throw new Error("Refusing to reset a non-test database.");
  const db = getDatabase();
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

/** An owner, a member, a board, and verified email pointing at the fake server. */
async function team(page: Page) {
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
      emailConfig: encryptSettings({
        host: "127.0.0.1",
        port: 25250,
        secure: false,
        username: "",
        password: "",
        fromEmail: "yuzu@example.test",
      }),
      emailConfigRevision: 1,
      emailVerifiedRevision: 1,
    },
  });
  const member = await db.user.create({
    data: {
      name: "Mia Member",
      email: "mia@example.test",
      emailVerified: true,
    },
  });
  await db.workspaceMember.create({
    data: { workspaceId: workspace.id, userId: member.id },
  });
  const made = await post(page, "/api/v1/boards/create-board", {
    workspaceId: workspace.id,
    name: "Launch",
  });
  return {
    owner,
    member,
    boardId: (await made.json()).data.id as string,
  };
}

/** Skip the 5-minute wait in tests. */
const sendNow = () =>
  getDatabase().emailMessage.updateMany({
    where: { status: "QUEUED" },
    data: { sendAfter: new Date() },
  });

test("assignments email after the delay, skip when read, and unsubscribe in one click", async ({
  page,
  mailbox,
}) => {
  test.setTimeout(90_000);
  const { member, boardId } = await team(page);
  const db = getDatabase();
  const assign = async (name: string) =>
    (
      await (
        await post(page, "/api/v1/boards/create-task", {
          boardId,
          createKey: crypto.randomUUID(),
          name,
          assigneeIds: [member.id],
        })
      ).json()
    ).data.taskId as string;

  const first = await assign("Checkout redesign");
  const queued = await db.emailMessage.findFirstOrThrow({
    where: { userId: member.id },
  });
  // It waits about five minutes so a quick look in the app cancels it.
  expect(queued.sendAfter.getTime() - Date.now()).toBeGreaterThan(4 * 60_000);
  await sendNow();
  await expect.poll(() => mailbox.length, { timeout: 20_000 }).toBe(1);
  const mail = mailbox[0]!;
  expect(mail).toContain("Subject: Team assigned you: Checkout redesign");
  expect(mail).toContain("To: mia@example.test");
  expect(mail).toContain("List-Unsubscribe-Post: List-Unsubscribe=One-Click");
  expect(mail).toContain(`/boards/${boardId}?task=${first}`);
  expect(mail).toContain("Content-Type: text/html");

  // Read in the app before the delay: no email.
  const second = await assign("Pricing page");
  await db.notification.updateMany({
    where: { taskId: second },
    data: { readAt: new Date() },
  });
  await sendNow();
  await expect
    .poll(
      async () =>
        (
          await db.emailMessage.findFirst({
            where: { notificationId: { not: null }, status: { not: "SENT" } },
          })
        )?.error,
      { timeout: 20_000 },
    )
    .toBe("Already read in Yuzu.");
  expect(mailbox).toHaveLength(1);

  // The unsubscribe link turns assignment emails off without signing in.
  const link = mail
    .match(/https?:\/\/[^\s"<>]*\/api\/v1\/email\/unsubscribe\?t=[^\s"<>]+/)![0]
    .replace(/&amp;/g, "&");
  const anonymous = await page.context().browser()!.newContext();
  const visit = await anonymous.newPage();
  await visit.goto(link.replace(/^https?:\/\/[^/]+/, ORIGIN));
  await expect(
    visit.getByRole("heading", { name: "You're unsubscribed" }),
  ).toBeVisible();
  await anonymous.close();
  expect(
    (
      await db.notificationPreference.findUniqueOrThrow({
        where: { userId_kind: { userId: member.id, kind: "ASSIGNMENT" } },
      })
    ).delivery,
  ).toBe("OFF");
  const before = await db.emailMessage.count();
  await assign("After unsubscribing");
  expect(await db.emailMessage.count()).toBe(before);
});

test("the daily digest gathers unread rule messages, and rules can send email", async ({
  page,
  mailbox,
}) => {
  test.setTimeout(120_000);
  const { member, boardId } = await team(page);
  const db = getDatabase();
  const save = (rule: Record<string, unknown>) =>
    post(page, "/api/v1/automations/save", { boardId, ...rule });
  // Rule messages go to the digest by default; this rule also emails directly.
  expect(
    (
      await save({
        name: "Welcome",
        trigger: { kind: "task.created" },
        actions: [
          {
            kind: "notify",
            to: "people",
            userIds: [member.id],
            message: "{task} is ready for you",
          },
          {
            kind: "email",
            to: "people",
            userIds: [member.id],
            subject: "Heads up: {task}",
            message: "{task} was just created on {board}",
          },
        ],
      })
    ).status(),
  ).toBe(200);
  await post(page, "/api/v1/boards/create-task", {
    boardId,
    createKey: crypto.randomUUID(),
    name: "Launch post",
  });
  // The rule's email goes out right away.
  await expect.poll(() => mailbox.length, { timeout: 20_000 }).toBe(1);
  expect(mailbox[0]).toContain("Subject: Heads up: Launch post");
  expect(mailbox[0]).toContain("Launch post was just created on Launch");

  // The notify step waits for the digest: make today's digest due now.
  const settings = await db.installationSettings.findUniqueOrThrow({
    where: { id: "installation" },
  });
  const now = new Intl.DateTimeFormat("en-GB", {
    timeZone: settings.timezone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(Date.now() + 60_000));
  await db.user.update({
    where: { id: member.id },
    data: {
      digestTime: now,
      lastDigestAt: new Date(Date.now() - 2 * 86_400_000),
    },
  });
  await expect
    .poll(() => mailbox.length, { timeout: 100_000, intervals: [2_000] })
    .toBe(2);
  expect(mailbox[1]).toContain("Subject: 1 update on Yuzu today");
  expect(mailbox[1]).toContain("Launch post is ready for you");
});

test("people read and change their email settings", async ({ page }) => {
  await team(page);
  const read = await (await page.request.get("/api/v1/email/settings")).json();
  expect(
    read.data.preferences.map(
      (item: { kind: string; delivery: string }) =>
        `${item.kind}:${item.delivery}`,
    ),
  ).toEqual([
    "ASSIGNMENT:INSTANT",
    "MENTION:INSTANT",
    "APPROVAL_REQUEST:INSTANT",
    "APPROVAL_DECISION:DIGEST",
    "AUTOMATION:DIGEST",
  ]);
  expect(read.data).toMatchObject({ digestTime: "08:00", emailReady: true });
  const saved = await post(page, "/api/v1/email/settings", {
    preferences: [{ kind: "MENTION", delivery: "OFF" }],
    digestTime: null,
  });
  expect(saved.status()).toBe(200);
  const after = (await saved.json()).data;
  expect(after.digestTime).toBeNull();
  expect(
    after.preferences.find((item: { kind: string }) => item.kind === "MENTION")
      .delivery,
  ).toBe("OFF");
});

test("people choose their email settings and build email rule steps", async ({
  page,
}) => {
  const { owner, boardId } = await team(page);
  const db = getDatabase();
  const delivery = async (kind: "MENTION") =>
    (
      await db.notificationPreference.findUnique({
        where: { userId_kind: { userId: owner.id, kind } },
      })
    )?.delivery;

  // The bell dropdown leads to the settings.
  await page.goto("/notifications");
  await page.getByRole("button", { name: /^Notifications/ }).click();
  await expect(
    page.getByRole("main").getByRole("link", { name: "Email settings" }),
  ).toBeVisible();
  await page
    .getByRole("dialog", { name: "Notifications" })
    .getByRole("link", { name: "Email settings" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Email notifications" }),
  ).toBeVisible();

  const mentions = page.getByRole("radiogroup", { name: "Mentions emails" });
  await expect(
    mentions.getByRole("radio", { name: "Instantly" }),
  ).toBeChecked();
  await mentions.getByRole("radio", { name: "Daily" }).click();
  await expect(page.getByRole("status").last()).toHaveText("Saved.");
  expect(await delivery("MENTION")).toBe("DIGEST");

  await page.getByLabel("Digest time").fill("17:30");
  await expect
    .poll(
      async () =>
        (await db.user.findUniqueOrThrow({ where: { id: owner.id } }))
          .digestTime,
    )
    .toBe("17:30");
  await page.screenshot({ path: "../../artifacts/email/settings.png" });
  await page.getByRole("switch", { name: "Daily digest" }).click();
  await expect(page.getByText("is off")).toBeVisible();
  await expect
    .poll(
      async () =>
        (await db.user.findUniqueOrThrow({ where: { id: owner.id } }))
          .digestTime,
    )
    .toBeNull();
  // Switching back on restores the chosen time.
  await page.getByRole("switch", { name: "Daily digest" }).click();
  await expect(page.getByLabel("Digest time")).toHaveValue("17:30");
  await page.reload();
  await expect(mentions.getByRole("radio", { name: "Daily" })).toBeChecked();

  // A rule step that sends an email.
  await page.goto(`/boards/${boardId}`);
  await page.getByRole("button", { name: "Automations", exact: true }).click();
  const sheet = page.getByRole("dialog", { name: "Automations" });
  await sheet.getByRole("button", { name: "New rule", exact: true }).click();
  const builder = page.getByRole("dialog", { name: "New rule" });
  await builder.getByLabel("Rule name").fill("Email on done");
  await builder.getByLabel("Action 1", { exact: true }).selectOption("email");
  await expect(builder.getByLabel("Action 1 subject")).toHaveValue(
    "Heads up: {task}",
  );
  await builder.getByLabel("Action 1 message").fill("{task} needs a look");
  await builder.screenshot({ path: "../../artifacts/email/rule-step.png" });
  await builder.getByRole("button", { name: "Save rule" }).click();
  await expect(builder).toHaveCount(0);
  const rule = await db.automationRule.findFirstOrThrow({ where: { boardId } });
  expect(rule.actions).toEqual([
    {
      kind: "email",
      to: "assignees",
      subject: "Heads up: {task}",
      message: "{task} needs a look",
    },
  ]);
});
