import { test as base, expect } from "@playwright/test";
import { SMTPServer } from "smtp-server";
import { createRecordId, getDatabase } from "@yuzu/database";
import { upgradeRecordIds } from "@yuzu/database/upgrade-ids";
import type { Page } from "@playwright/test";
import { presets } from "../src/components/design-preview/theme-model";
import { encryptSettings } from "../src/server/setup/security";

process.env.DATABASE_URL = process.env.YUZU_E2E_DATABASE_URL;
process.env.SETTINGS_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64url");
const test = base.extend<{ mailbox: string[] }>({
  mailbox: async ({}, provide) => {
    const messages: string[] = [];
    const server = new SMTPServer({
      authOptional: true,
      disabledCommands: ["STARTTLS", "AUTH"],
      onData(stream, _session, callback) {
        let body = "";
        stream.on("data", (chunk) => {
          body += chunk.toString();
        });
        stream.on("end", () => {
          messages.push(body);
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
  await db.workspaceMember.deleteMany();
  await db.workspace.deleteMany();
  await db.user.deleteMany();
  await db.verification.deleteMany();
  await db.authenticationAttempt.deleteMany();
});

test("welcome is interactive, responsive, and gates uninitialized workspace routes", async ({
  page,
  request,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/boards");
  await expect(page).toHaveURL(/\/welcome$/);
  await expect(
    page.getByRole("heading", {
      name: "Don't just manage work. Build the systems that run it.",
    }),
  ).toBeVisible();
  await expect(page.locator("form")).toHaveCount(0);
  await page.getByRole("button", { name: "Kanban", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "In progress", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("link", { name: "Get Started", exact: true }).click();
  await expect(page).toHaveURL(/\/setup$/);
  await expect(
    page.getByRole("heading", { name: "Make yourself at home." }),
  ).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Installation key")).toBeVisible();
  const forbidden = await request.post("/api/v1/setup/installation", {
    headers: { origin: "http://127.0.0.1:3100" },
    data: {
      name: "Attempt",
      timezone: "UTC",
      defaultDateFormat: "yyyy-MM-dd",
      revision: 1,
    },
  });
  expect(forbidden.status()).toBe(403);
  const signup = await request.post("/api/auth/sign-up/email", {
    headers: { origin: "http://127.0.0.1:3100" },
    data: {
      name: "Intruder",
      email: "intruder@example.test",
      password: "long-test-password",
    },
  });
  expect(signup.status()).toBe(403);
  expect(await getDatabase().user.count()).toBe(0);
});

test("owner setup resumes, verifies actual receipt, and completes exactly once", async ({
  page,
  mailbox,
  request,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/welcome");
  await page.getByRole("link", { name: "Get Started", exact: true }).click();
  await expect(page).toHaveURL(/\/setup$/);
  await page
    .getByLabel("Installation key")
    .fill("wrong-key-that-is-long-enough-to-validate");
  await page.getByLabel("Your name").fill("Test Owner");
  await page.getByLabel("Email address").fill("owner@example.test");
  await page
    .getByLabel("Password", { exact: true })
    .fill("test-owner-password-123");
  await page.getByLabel("Confirm password").fill("test-owner-password-123");
  await page.getByRole("button", { name: "Create owner account" }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "incorrect" }),
  ).toBeVisible();
  await page
    .getByLabel("Installation key")
    .fill(process.env.YUZU_E2E_SETUP_KEY!);
  await page.getByRole("button", { name: "Create owner account" }).click();
  await expect(
    page.getByRole("heading", { name: "Give your workspace an identity." }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Give your workspace an identity." }),
  ).toBeVisible();
  await page.getByLabel("Installation name").fill("Test Yuzu");
  await page.getByLabel("Timezone").fill("Asia/Singapore");
  await page.getByRole("button", { name: "Save and continue" }).click();
  const premature = await page.request.post("/api/v1/setup/complete", {
    headers: { origin: "http://127.0.0.1:3100" },
    data: { workspaceName: "Team", boardName: "Project", revision: 2 },
  });
  expect(premature.status()).toBe(422);
  await page.getByLabel("SMTP host").fill("127.0.0.1");
  await page.getByLabel("Port", { exact: true }).fill("25251");
  await page.getByLabel("Sender email").fill("yuzu@example.test");
  await page.getByRole("button", { name: "Send verification email" }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "Email could not be sent" }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "A reliable way to stay connected." }),
  ).toBeVisible();
  await page.getByLabel("Port", { exact: true }).fill("25250");
  await page.getByLabel("Sender email").fill("yuzu@example.test");
  await page.getByRole("button", { name: "Send verification email" }).click();
  await expect(
    page.getByRole("heading", { name: "Check your inbox." }),
  ).toBeVisible();
  const code = mailbox[0]?.match(/Your verification code is: (\d{6})/)?.[1];
  expect(code).toBeTruthy();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Check your inbox." }),
  ).toBeVisible();
  const metadata = await page.request.get("/api/v1/setup/status");
  expect(await metadata.text()).not.toContain("verificationDigest");
  await page.getByLabel("Verification code").fill("000000");
  await page.getByRole("button", { name: "Verify and continue" }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "incorrect" }),
  ).toBeVisible();
  await page.getByLabel("Verification code").fill(code!);
  await page.getByRole("button", { name: "Verify and continue" }).click();
  await expect(
    page.getByRole("heading", { name: "Make room for your first project." }),
  ).toBeVisible();
  await page.getByLabel("Workspace name").fill("Our team");
  await page.getByLabel("First board name").fill("Launch project");
  const beforeCompletion = (
    await (await page.request.get("/api/v1/setup/status")).json()
  ).data;
  const simultaneous = await Promise.all(
    [1, 2].map(() =>
      page.request.post("/api/v1/setup/complete", {
        headers: { origin: "http://127.0.0.1:3100" },
        data: {
          workspaceName: "Our team",
          boardName: "Launch project",
          revision: beforeCompletion.settings.revision,
        },
      }),
    ),
  );
  simultaneous.forEach((response) => expect(response.status()).toBe(200));
  await page.getByRole("button", { name: "Finish installation" }).click();
  await expect(
    page.getByRole("heading", { name: "Your workspace is ready." }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Open your board" }).click();
  await expect(
    page.getByRole("heading", { name: "Launch project" }),
  ).toBeVisible();
  const db = getDatabase();
  expect(await db.user.count()).toBe(1);
  expect(await db.workspace.count()).toBe(1);
  expect(await db.board.count()).toBe(1);
  expect(await db.boardColumn.count()).toBe(6);
  const uuid7 =
    /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  const generatedRecords = await Promise.all([
    db.user.findMany(),
    db.account.findMany(),
    db.session.findMany(),
    db.workspace.findMany(),
    db.board.findMany(),
    db.boardColumn.findMany(),
    db.boardGroup.findMany(),
  ]);
  for (const records of generatedRecords)
    for (const record of records) expect(record.id).toMatch(uuid7);
  const repeat = await page.request.post("/api/v1/setup/complete", {
    headers: { origin: "http://127.0.0.1:3100" },
    data: { workspaceName: "Duplicate", boardName: "Duplicate", revision: 1 },
  });
  expect(repeat.status()).toBe(200);
  expect(await db.board.count()).toBe(1);
  const duplicateOwner = await request.post("/api/v1/setup/owner", {
    headers: { origin: "http://127.0.0.1:3100" },
    data: {
      name: "Other",
      email: "other@example.test",
      password: "test-owner-password-123",
      confirmPassword: "test-owner-password-123",
      setupKey: process.env.YUZU_E2E_SETUP_KEY,
    },
  });
  expect(duplicateOwner.status()).toBe(409);
  const anonymous = await request.get("/api/v1/setup/status");
  const publicState = await anonymous.json();
  expect(publicState.data.authorized).toBe(false);
  expect(publicState.data.settings).toBeUndefined();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/sign-in$/);
  await page.getByLabel("Email address").fill("owner@example.test");
  await page
    .getByLabel("Password", { exact: true })
    .fill("test-owner-password-123");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Good work starts here." }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test("concurrent claims select one owner and prevent replay", async ({
  request,
}) => {
  const claims = await Promise.all(
    ["first", "second"].map((name) =>
      request.post("/api/v1/setup/owner", {
        headers: { origin: "http://127.0.0.1:3100" },
        data: {
          name: `${name} Owner`,
          email: `${name}@example.test`,
          password: "test-owner-password-123",
          confirmPassword: "test-owner-password-123",
          setupKey: process.env.YUZU_E2E_SETUP_KEY,
        },
      }),
    ),
  );
  expect(claims.map((response) => response.status()).sort()).toEqual([
    200, 409,
  ]);
  expect(await getDatabase().user.count()).toBe(1);
  expect(await getDatabase().setupClaim.count()).toBe(1);
});

test("interrupted identity creation resumes within the original claim", async ({
  request,
}) => {
  const db = getDatabase();
  await db.setupClaim.create({
    data: {
      email: "resume@example.test",
      intentDigest: "expired",
      intentExpiresAt: new Date(0),
    },
  });
  const interruptedUserId = createRecordId();
  await db.user.create({
    data: {
      id: interruptedUserId,
      name: "Incomplete",
      email: "resume@example.test",
    },
  });
  const response = await request.post("/api/v1/setup/owner", {
    headers: { origin: "http://127.0.0.1:3100" },
    data: {
      name: "Recovered owner",
      email: "resume@example.test",
      password: "test-owner-password-123",
      confirmPassword: "test-owner-password-123",
      setupKey: process.env.YUZU_E2E_SETUP_KEY,
    },
  });
  expect(response.status()).toBe(200);
  expect(await db.user.count()).toBe(1);
  expect(
    (
      await db.installationSettings.findUniqueOrThrow({
        where: { id: "installation" },
      })
    ).ownerId,
  ).not.toBe(interruptedUserId);
});

test("owner address correction requires password and invalidates old receipt", async ({
  request,
}) => {
  const db = getDatabase();
  await request.post("/api/v1/setup/owner", {
    headers: { origin: "http://127.0.0.1:3100" },
    data: {
      name: "Owner",
      email: "original@example.test",
      password: "test-owner-password-123",
      confirmPassword: "test-owner-password-123",
      setupKey: process.env.YUZU_E2E_SETUP_KEY,
    },
  });
  await db.installationSettings.update({
    where: { id: "installation" },
    data: {
      verificationDigest: "old-code",
      verificationExpiresAt: new Date(Date.now() + 60_000),
      emailVerifiedRevision: 1,
      verificationSentAt: new Date(),
    },
  });
  const incorrect = await request.post("/api/v1/setup/owner-email", {
    headers: { origin: "http://127.0.0.1:3100" },
    data: {
      email: "corrected@example.test",
      password: "incorrect-password-123",
    },
  });
  expect(incorrect.status()).toBe(403);
  const corrected = await request.post("/api/v1/setup/owner-email", {
    headers: { origin: "http://127.0.0.1:3100" },
    data: {
      email: "corrected@example.test",
      password: "test-owner-password-123",
    },
  });
  expect(corrected.status()).toBe(200);
  const settings = await db.installationSettings.findUniqueOrThrow({
    where: { id: "installation" },
    include: { owner: true },
  });
  expect(settings.owner?.email).toBe("corrected@example.test");
  expect(settings.verificationDigest).toBeNull();
  expect(settings.emailVerifiedRevision).toBeNull();
  expect(settings.verificationSentAt).toBeNull();
});

test("both sign-in entry points enforce the persistent attempt limit", async ({
  request,
}) => {
  const { createHash } = await import("node:crypto");
  const email = "limited@example.test";
  await getDatabase().authenticationAttempt.create({
    data: {
      id: `sign-in:${createHash("sha256").update(email).digest("hex")}`,
      count: 10,
      windowStart: new Date(),
    },
  });
  for (const route of ["/api/auth/sign-in/email", "/api/v1/session/sign-in"]) {
    const response = await request.post(route, {
      headers: { origin: "http://127.0.0.1:3100" },
      data: { email, password: "test-password-123" },
    });
    expect(response.status()).toBe(429);
  }
});

test("health remains minimal and database-ready", async ({ request }) => {
  for (const [route, status] of [
    ["/api/health", "ok"],
    ["/api/health/ready", "ready"],
  ]) {
    const response = await request.get(route);
    expect(response.status()).toBe(200);
    expect(response.headers()["cache-control"]).toContain("no-store");
    expect(await response.json()).toMatchObject({
      data: { status },
      requestId: expect.any(String),
    });
  }
});

async function readyTeam(page: Page) {
  const created = await page.request.post("/api/v1/setup/owner", {
    headers: { origin: "http://127.0.0.1:3100" },
    data: {
      name: "Team Owner",
      email: "owner@example.test",
      password: "test-owner-password-123",
      confirmPassword: "test-owner-password-123",
      setupKey: process.env.YUZU_E2E_SETUP_KEY,
    },
  });
  expect(created.status()).toBe(200);
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
    data: {
      name: "Team project",
      workspaceId: workspace.id,
      createdById: owner.id,
    },
  });
  const other = await db.workspace.create({
    data: { name: "Other workspace", createdById: owner.id },
  });
  const otherBoard = await db.board.create({
    data: {
      name: "Restricted project",
      workspaceId: other.id,
      createdById: owner.id,
    },
  });
  await db.installationSettings.update({
    where: { id: "installation" },
    data: {
      setupState: "READY",
      initialWorkspaceId: workspace.id,
      initialBoardId: board.id,
      emailConfigRevision: 1,
      emailVerifiedRevision: 1,
      emailConfig: encryptSettings({
        host: "127.0.0.1",
        port: 25250,
        secure: false,
        username: "",
        password: "",
        fromEmail: "yuzu@example.test",
      }),
    },
  });
  return { workspace, board, other, otherBoard };
}

const postTeam = (page: Page, action: string, data: unknown) =>
  page.request.post(`/api/v1/team/${action}`, {
    headers: { origin: "http://127.0.0.1:3100" },
    data,
  });
const invitationToken = (message: string) =>
  message.replace(/=\r?\n/g, "").match(/\/invite#([A-Za-z0-9_-]{43})/)?.[1];

const recoveryToken = (message: string) =>
  message
    .replace(/=\r?\n/g, "")
    .match(/\/reset-password#([A-Za-z0-9_-]{43})/)?.[1];

test("legacy IDs upgrade atomically without losing credentials, memberships, references or dates", async ({
  page,
}) => {
  const { workspace, board } = await readyTeam(page);
  const db = getDatabase();
  const owner = await db.user.findUniqueOrThrow({
    where: { email: "owner@example.test" },
  });
  const account = await db.account.findFirstOrThrow({
    where: { userId: owner.id, providerId: "credential" },
  });
  await db.user.update({
    where: { id: owner.id },
    data: { id: "legacy-owner" },
  });
  await db.account.update({
    where: { id: account.id },
    data: { id: "legacy-account", accountId: "legacy-owner" },
  });
  const member = await db.user.create({
    data: {
      id: "legacy-member",
      name: "Existing teammate",
      email: "legacy@example.test",
      createdAt: new Date("2020-01-01T00:00:00Z"),
    },
  });
  await db.workspaceMember.create({
    data: { workspaceId: workspace.id, userId: member.id },
  });
  await db.workspace.update({
    where: { id: workspace.id },
    data: { id: "legacy-workspace" },
  });
  await db.board.update({
    where: { id: board.id },
    data: { id: "legacy-board" },
  });
  await db.installationSettings.update({
    where: { id: "installation" },
    data: {
      initialWorkspaceId: "legacy-workspace",
      initialBoardId: "legacy-board",
    },
  });
  await db.boardColumn.create({
    data: {
      id: "legacy-column",
      boardId: "legacy-board",
      key: "name",
      name: "Task",
      type: "TEXT",
      position: 0,
    },
  });
  await db.boardGroup.create({
    data: {
      id: "legacy-group",
      boardId: "legacy-board",
      name: "Tasks",
      position: 0,
    },
  });
  await db.invitation.create({
    data: {
      id: "legacy-invitation",
      workspaceId: "legacy-workspace",
      invitedById: "legacy-owner",
      email: "invited@example.test",
      tokenDigest: "existing-digest",
      expiresAt: new Date(Date.now() + 60_000),
    },
  });
  await db.accessEvent.create({
    data: {
      id: "legacy-event",
      workspaceId: "legacy-workspace",
      actorId: "legacy-owner",
      action: "INVITATION_SENT",
      subjectEmail: "invited@example.test",
    },
  });
  await db.verification.create({
    data: {
      id: "legacy-recovery",
      identifier: "legacy-recovery",
      value: "legacy-owner",
      expiresAt: new Date(Date.now() + 60_000),
    },
  });
  const upgraded = await upgradeRecordIds(process.env.DATABASE_URL!);
  expect(upgraded.converted).toEqual({
    User: 2,
    Account: 1,
    Workspace: 1,
    Board: 1,
    BoardColumn: 1,
    BoardGroup: 1,
    Invitation: 1,
    AccessEvent: 1,
  });
  expect(upgraded.sessionsCleared).toBeGreaterThan(0);
  expect(upgraded.verificationsCleared).toBe(1);
  const updatedOwner = await db.user.findUniqueOrThrow({
    where: { email: owner.email },
  });
  const updatedWorkspace = await db.workspace.findFirstOrThrow({
    where: { name: workspace.name },
  });
  const updatedBoard = await db.board.findFirstOrThrow({
    where: { name: board.name },
  });
  const updatedAccount = await db.account.findFirstOrThrow({
    where: { userId: updatedOwner.id },
  });
  expect(updatedOwner.role).toBe("OWNER");
  expect(updatedAccount.password).toBe(account.password);
  expect(updatedAccount.accountId).toBe(updatedOwner.id);
  expect(updatedWorkspace.createdAt).toEqual(workspace.createdAt);
  expect(updatedBoard.createdAt).toEqual(board.createdAt);
  expect(updatedBoard.workspaceId).toBe(updatedWorkspace.id);
  const settings = await db.installationSettings.findUniqueOrThrow({
    where: { id: "installation" },
  });
  expect(settings.ownerId).toBe(updatedOwner.id);
  expect(settings.initialWorkspaceId).toBe(updatedWorkspace.id);
  expect(settings.initialBoardId).toBe(updatedBoard.id);
  expect(
    await db.workspaceMember.count({
      where: { workspaceId: updatedWorkspace.id },
    }),
  ).toBe(2);
  expect((await db.boardColumn.findFirstOrThrow()).boardId).toBe(
    updatedBoard.id,
  );
  expect((await db.boardGroup.findFirstOrThrow()).boardId).toBe(
    updatedBoard.id,
  );
  expect((await db.invitation.findFirstOrThrow()).invitedById).toBe(
    updatedOwner.id,
  );
  expect((await db.accessEvent.findFirstOrThrow()).actorId).toBe(
    updatedOwner.id,
  );
  const updatedMember = await db.user.findUniqueOrThrow({
    where: { email: member.email },
  });
  expect(
    Number.parseInt(updatedMember.id.replaceAll("-", "").slice(0, 12), 16),
  ).toBe(member.createdAt.getTime());
  expect(updatedMember.id < updatedOwner.id).toBe(true);
  const signedIn = await page.request.post("/api/v1/session/sign-in", {
    headers: { origin: "http://127.0.0.1:3100" },
    data: { email: owner.email, password: "test-owner-password-123" },
  });
  expect(signedIn.status()).toBe(200);
  await page.goto(`/boards/${updatedBoard.id}`);
  await expect(
    page.getByRole("heading", { name: "Team project" }),
  ).toBeVisible();
  const repeated = await upgradeRecordIds(process.env.DATABASE_URL!);
  expect(Object.values(repeated.converted).every((count) => count === 0)).toBe(
    true,
  );
  expect(repeated.sessionsCleared).toBe(0);
  expect((await page.request.get("/api/v1/team/state")).status()).toBe(200);
});
const postRecovery = (page: Page, action: string, data: unknown) =>
  page.request.post(`/api/v1/recovery/${action}`, {
    headers: { origin: "http://127.0.0.1:3100" },
    data,
  });

test("recovery links become invalid after a password change and reset attempts are limited", async ({
  page,
  mailbox,
}) => {
  await readyTeam(page);
  expect(
    (
      await postRecovery(page, "request", { email: "owner@example.test" })
    ).status(),
  ).toBe(200);
  await expect.poll(() => mailbox.length).toBe(1);
  const token = recoveryToken(mailbox[0]);
  const changed = await page.request.post("/api/auth/change-password", {
    headers: { origin: "http://127.0.0.1:3100" },
    data: {
      currentPassword: "test-owner-password-123",
      newPassword: "changed-owner-password-123",
    },
  });
  expect(changed.status()).toBe(200);
  expect(
    (
      await postRecovery(page, "reset", {
        token,
        password: "obsolete-link-password-123",
        confirmation: "obsolete-link-password-123",
      })
    ).status(),
  ).toBe(410);
  const invalid = "x".repeat(43);
  for (let attempt = 0; attempt < 10; attempt++)
    expect(
      (
        await postRecovery(page, "reset", {
          token: invalid,
          password: "new-owner-password-456",
          confirmation: "new-owner-password-456",
        })
      ).status(),
    ).toBe(410);
  expect(
    (
      await postRecovery(page, "reset", {
        token: invalid,
        password: "new-owner-password-456",
        confirmation: "new-owner-password-456",
      })
    ).status(),
  ).toBe(429);
});

test("password recovery works from email and revokes every existing session", async ({
  page,
  browser,
  mailbox,
}) => {
  const { board } = await readyTeam(page);
  const db = getDatabase();
  const owner = await db.user.findUniqueOrThrow({
    where: { email: "owner@example.test" },
  });
  const otherSession = await browser.newContext({
    baseURL: "http://127.0.0.1:3100",
  });
  const recoveryContext = await browser.newContext({
    baseURL: "http://127.0.0.1:3100",
    viewport: { width: 390, height: 844 },
  });
  try {
    expect(
      (
        await otherSession.request.post("/api/v1/session/sign-in", {
          headers: { origin: "http://127.0.0.1:3100" },
          data: { email: owner.email, password: "test-owner-password-123" },
        })
      ).status(),
    ).toBe(200);
    expect(
      await db.session.count({ where: { userId: owner.id } }),
    ).toBeGreaterThanOrEqual(2);
    const recoveryPage = await recoveryContext.newPage();
    await recoveryPage.goto("/sign-in");
    await recoveryPage.getByRole("link", { name: "Forgot password?" }).click();
    await recoveryPage.getByLabel("Email address").fill("OWNER@example.test");
    await recoveryPage
      .getByRole("button", { name: "Send recovery link" })
      .click();
    await expect(recoveryPage.getByRole("status")).toContainText(
      "If an account exists",
    );
    await expect.poll(() => mailbox.length).toBe(1);
    const token = recoveryToken(mailbox[0]);
    expect(token).toBeTruthy();
    const records = await db.verification.findMany({
      where: { id: { startsWith: "yuzu-password-reset:" } },
    });
    expect(records).toHaveLength(1);
    expect(JSON.stringify(records)).not.toContain(token);
    await recoveryPage.goto(`/reset-password#${token}`);
    await recoveryPage
      .getByLabel("New password")
      .fill("new-owner-password-456");
    await recoveryPage
      .getByLabel("Confirm password")
      .fill("different-password-456");
    await expect(
      recoveryPage
        .getByRole("alert")
        .filter({ hasText: "Passwords must match" }),
    ).toContainText("Passwords must match");
    await recoveryPage
      .getByLabel("Confirm password")
      .fill("new-owner-password-456");
    await recoveryPage.getByRole("button", { name: "Update password" }).click();
    await expect(
      recoveryPage.getByRole("heading", { name: "Your password is updated." }),
    ).toBeVisible();
    expect(new URL(recoveryPage.url()).hash).toBe("");
    expect(await db.session.count({ where: { userId: owner.id } })).toBe(0);
    expect(
      await (await otherSession.request.get("/api/auth/get-session")).json(),
    ).toBeNull();
    await page.goto(`/boards/${board.id}`);
    await expect(page).toHaveURL(/\/sign-in$/);
    const replay = await postRecovery(recoveryPage, "reset", {
      token,
      password: "replacement-password-789",
      confirmation: "replacement-password-789",
    });
    expect(replay.status()).toBe(410);
    expect(
      (
        await recoveryPage.request.post("/api/v1/session/sign-in", {
          headers: { origin: "http://127.0.0.1:3100" },
          data: { email: owner.email, password: "test-owner-password-123" },
        })
      ).ok(),
    ).toBe(false);
    await recoveryPage.getByRole("link", { name: "Sign in to Yuzu" }).click();
    await recoveryPage.getByLabel("Email address").fill(owner.email);
    await recoveryPage
      .getByLabel("Password", { exact: true })
      .fill("new-owner-password-456");
    await recoveryPage
      .getByRole("button", { name: "Sign in", exact: true })
      .click();
    await expect(
      recoveryPage.getByRole("heading", { name: "Good work starts here." }),
    ).toBeVisible();
    expect(
      (await db.user.findUniqueOrThrow({ where: { id: owner.id } })).role,
    ).toBe("OWNER");
  } finally {
    await otherSession.close();
    await recoveryContext.close();
  }
});

test("recovery requests hide account existence and guard cooldown, origin, setup and native endpoints", async ({
  page,
  request,
  mailbox,
}) => {
  const headers = { origin: "http://127.0.0.1:3100" };
  expect(
    (
      await request.post("/api/v1/recovery/request", {
        headers,
        data: { email: "owner@example.test" },
      })
    ).status(),
  ).toBe(503);
  await readyTeam(page);
  const known = await postRecovery(page, "request", {
    email: "owner@example.test",
  });
  const unknown = await postRecovery(page, "request", {
    email: "unknown@example.test",
  });
  expect(known.status()).toBe(200);
  expect(unknown.status()).toBe(200);
  expect((await known.json()).data).toEqual((await unknown.json()).data);
  expect(known.headers()["cache-control"]).toBe("no-store");
  await expect.poll(() => mailbox.length).toBe(1);
  expect(
    (
      await postRecovery(page, "request", { email: "OWNER@example.test" })
    ).status(),
  ).toBe(429);
  expect(
    (
      await postRecovery(page, "request", { email: "unknown@example.test" })
    ).status(),
  ).toBe(429);
  expect(
    (
      await request.post("/api/v1/recovery/request", {
        headers: { origin: "https://untrusted.example" },
        data: { email: "owner@example.test" },
      })
    ).status(),
  ).toBe(403);
  expect(
    (
      await postRecovery(page, "request", {
        email: "owner@example.test",
        redirectTo: "https://untrusted.example",
      })
    ).status(),
  ).toBe(422);
  expect(
    (
      await request.post("/api/auth/request-password-reset", {
        headers,
        data: { email: "owner@example.test" },
      })
    ).status(),
  ).toBe(403);
  expect(
    (
      await request.post("/api/auth/reset-password", {
        headers,
        data: {
          token: recoveryToken(mailbox[0]),
          newPassword: "bypass-password-123",
        },
      })
    ).status(),
  ).toBe(403);
});

test("recovery expires, replaces old links, and allows only one concurrent reset", async ({
  page,
  request,
  mailbox,
}) => {
  await readyTeam(page);
  const db = getDatabase();
  expect(
    (
      await postRecovery(page, "request", { email: "owner@example.test" })
    ).status(),
  ).toBe(200);
  await expect.poll(() => mailbox.length).toBe(1);
  const expiredToken = recoveryToken(mailbox[0]);
  await db.verification.updateMany({
    where: { id: { startsWith: "yuzu-password-reset:" } },
    data: { expiresAt: new Date(0) },
  });
  expect(
    (
      await postRecovery(page, "reset", {
        token: expiredToken,
        password: "new-password-456",
        confirmation: "new-password-456",
      })
    ).status(),
  ).toBe(410);
  const requestAgain = async () => {
    await db.authenticationAttempt.updateMany({
      where: { id: { startsWith: "recovery-request:" } },
      data: { windowStart: new Date(Date.now() - 61_000) },
    });
    expect(
      (
        await postRecovery(page, "request", { email: "owner@example.test" })
      ).status(),
    ).toBe(200);
  };
  await requestAgain();
  await expect.poll(() => mailbox.length).toBe(2);
  const replacedToken = recoveryToken(mailbox[1]);
  await requestAgain();
  await expect.poll(() => mailbox.length).toBe(3);
  const token = recoveryToken(mailbox[2]);
  expect(
    (
      await postRecovery(page, "reset", {
        token: replacedToken,
        password: "new-password-456",
        confirmation: "new-password-456",
      })
    ).status(),
  ).toBe(410);
  expect(
    (
      await postRecovery(page, "reset", {
        token,
        password: "new-password-456",
        confirmation: "different-password-789",
      })
    ).status(),
  ).toBe(422);
  const responses = await Promise.all(
    ["first-password-123", "second-password-456"].map((password) =>
      request.post("/api/v1/recovery/reset", {
        headers: { origin: "http://127.0.0.1:3100" },
        data: { token, password, confirmation: password },
      }),
    ),
  );
  expect(responses.map((response) => response.status()).sort()).toEqual([
    200, 410,
  ]);
  expect(
    await db.verification.count({
      where: { id: { startsWith: "yuzu-password-reset:" } },
    }),
  ).toBe(0);
});

test("failed recovery delivery is generic and cannot activate a link or change credentials", async ({
  page,
}) => {
  await readyTeam(page);
  const db = getDatabase();
  const owner = await db.user.findUniqueOrThrow({
    where: { email: "owner@example.test" },
  });
  const account = await db.account.findFirstOrThrow({
    where: { userId: owner.id, providerId: "credential" },
  });
  await db.installationSettings.update({
    where: { id: "installation" },
    data: {
      emailConfig: encryptSettings({
        host: "127.0.0.1",
        port: 25251,
        secure: false,
        username: "",
        password: "",
        fromEmail: "yuzu@example.test",
      }),
    },
  });
  const known = await postRecovery(page, "request", { email: owner.email });
  const unknown = await postRecovery(page, "request", {
    email: "unknown@example.test",
  });
  expect(known.status()).toBe(200);
  expect((await known.json()).data).toEqual((await unknown.json()).data);
  await expect
    .poll(() =>
      db.verification.count({
        where: { id: { startsWith: "yuzu-password-reset:" } },
      }),
    )
    .toBe(0);
  expect(
    (await db.account.findUniqueOrThrow({ where: { id: account.id } }))
      .password,
  ).toBe(account.password);
  expect(
    await db.session.count({ where: { userId: owner.id } }),
  ).toBeGreaterThan(0);
});

test("teammate joins from email, signs in, and loses board access immediately on removal", async ({
  page,
  browser,
  mailbox,
}) => {
  const { workspace, board, other, otherBoard } = await readyTeam(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/settings");
  await page.getByRole("link", { name: "Manage team access" }).click();
  await page.getByLabel("Teammate email").fill("TEAMMATE@example.test");
  await page
    .getByRole("button", { name: "Send invitation", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("Invitation sent");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  const token = invitationToken(mailbox[0]);
  expect(token).toBeTruthy();
  const state = await page.request.get("/api/v1/team/state");
  expect(await state.text()).not.toContain("tokenDigest");
  const context = await browser.newContext({
    baseURL: "http://127.0.0.1:3100",
    viewport: { width: 390, height: 844 },
  });
  const teammatePage = await context.newPage();
  try {
    await teammatePage.goto(`/invite#${token}`);
    await expect(
      teammatePage.getByRole("heading", { name: "Join Our team" }),
    ).toBeVisible();
    await teammatePage.getByLabel("Your name").fill("Teammate");
    await teammatePage
      .getByLabel("Password", { exact: true })
      .fill("teammate-password-123");
    await teammatePage
      .getByLabel("Confirm password")
      .fill("teammate-password-123");
    await teammatePage
      .getByRole("button", { name: "Accept invitation" })
      .click();
    await expect(
      teammatePage.getByRole("heading", { name: "You’re part of the team." }),
    ).toBeVisible();
    await teammatePage.getByRole("link", { name: "Sign in to Yuzu" }).click();
    await teammatePage
      .getByLabel("Email address")
      .fill("teammate@example.test");
    await teammatePage
      .getByLabel("Password", { exact: true })
      .fill("teammate-password-123");
    await teammatePage
      .getByRole("button", { name: "Sign in", exact: true })
      .click();
    await expect(teammatePage).toHaveURL("http://127.0.0.1:3100/");
    await teammatePage.goto(`/boards/${board.id}`);
    await expect(
      teammatePage.getByRole("heading", { name: "Team project" }),
    ).toBeVisible();
    await teammatePage.goto("/boards");
    await expect(
      teammatePage.getByRole("heading", { name: "Restricted project" }),
    ).toHaveCount(0);
    await teammatePage.goto(`/boards/${otherBoard.id}`);
    await expect(
      teammatePage.getByText("Page not found", { exact: true }),
    ).toBeVisible();
    await expect(
      teammatePage.getByRole("heading", { name: "Restricted project" }),
    ).toHaveCount(0);
    await teammatePage.goto("/settings/team");
    await expect(
      teammatePage.getByText("Page not found", { exact: true }),
    ).toBeVisible();
    await expect(
      teammatePage.getByRole("heading", { name: "Team access" }),
    ).toHaveCount(0);
    expect(
      (await teammatePage.request.get("/api/v1/team/state")).status(),
    ).toBe(403);
    expect(
      (
        await postTeam(teammatePage, "invite", {
          workspaceId: workspace.id,
          email: "intruder@example.test",
        })
      ).status(),
    ).toBe(403);
    const db = getDatabase();
    const teammate = await db.user.findUniqueOrThrow({
      where: { email: "teammate@example.test" },
    });
    expect(teammate.role).toBe("MEMBER");
    expect(
      (
        await postTeam(teammatePage, "remove", {
          workspaceId: workspace.id,
          userId: teammate.id,
        })
      ).status(),
    ).toBe(403);
    const acceptedInvite = await db.invitation.findUniqueOrThrow({
      where: {
        workspaceId_email: { workspaceId: workspace.id, email: teammate.email },
      },
    });
    expect(
      (
        await postTeam(teammatePage, "revoke", { id: acceptedInvite.id })
      ).status(),
    ).toBe(403);
    const replay = await postTeam(teammatePage, "accept", { token });
    expect(replay.status()).toBe(410);
    expect(
      (
        await postTeam(page, "remove", {
          workspaceId: workspace.id,
          userId: teammate.id,
        })
      ).status(),
    ).toBe(200);
    await teammatePage.goto(`/boards/${board.id}`);
    await expect(
      teammatePage.getByText("Page not found", { exact: true }),
    ).toBeVisible();
    await expect(
      teammatePage.getByRole("heading", { name: "Team project" }),
    ).toHaveCount(0);
    await teammatePage.goto("/");
    await expect(
      teammatePage.getByText("Team project", { exact: true }),
    ).toHaveCount(0);
    expect(
      await db.accessEvent.count({
        where: { action: "MEMBER_REMOVED", subjectEmail: teammate.email },
      }),
    ).toBe(1);
    expect(
      (
        await postTeam(page, "invite", {
          workspaceId: other.id,
          email: teammate.email,
        })
      ).status(),
    ).toBe(200);
    const existingToken = invitationToken(mailbox[1]);
    const anonymousAcceptance = await page.context().browser()!.newContext();
    try {
      expect(
        (
          await anonymousAcceptance.request.post(
            "http://127.0.0.1:3100/api/v1/team/accept",
            {
              headers: { origin: "http://127.0.0.1:3100" },
              data: {
                token: existingToken,
                name: "Impersonator",
                password: "different-password-123",
              },
            },
          )
        ).status(),
      ).toBe(403);
    } finally {
      await anonymousAcceptance.close();
    }
    await teammatePage.request.post("/api/v1/session/sign-out", {
      headers: { origin: "http://127.0.0.1:3100" },
      data: {},
    });
    await teammatePage.goto(`/invite#${existingToken}`);
    await teammatePage.getByLabel("Email address").fill(teammate.email);
    await teammatePage
      .getByLabel("Password", { exact: true })
      .fill("teammate-password-123");
    await teammatePage
      .getByRole("button", { name: "Sign in", exact: true })
      .click();
    await expect(
      teammatePage.getByRole("heading", { name: "Join Other workspace" }),
    ).toBeVisible();
    await teammatePage
      .getByRole("button", { name: "Accept invitation" })
      .click();
    await teammatePage
      .getByRole("link", { name: "Open workspace", exact: true })
      .click();
    await expect(
      teammatePage.getByText("Restricted project", { exact: true }),
    ).toBeVisible();
    expect(await db.user.count({ where: { email: teammate.email } })).toBe(1);
    await page.reload();
    await expect(
      page.getByText("teammate@example.test", { exact: true }),
    ).toBeVisible();
  } finally {
    await context.close();
  }
});

test("resending invalidates old links and failed delivery never becomes a usable invitation", async ({
  page,
  mailbox,
}) => {
  const { workspace } = await readyTeam(page);
  const db = getDatabase();
  expect(
    (
      await postTeam(page, "invite", {
        workspaceId: workspace.id,
        email: "resend@example.test",
      })
    ).status(),
  ).toBe(200);
  const oldToken = invitationToken(mailbox[0]);
  await db.invitation.updateMany({
    where: { email: "resend@example.test" },
    data: { createdAt: new Date(Date.now() - 61_000) },
  });
  expect(
    (
      await postTeam(page, "invite", {
        workspaceId: workspace.id,
        email: "resend@example.test",
      })
    ).status(),
  ).toBe(200);
  const newToken = invitationToken(mailbox[1]);
  expect(newToken).not.toBe(oldToken);
  expect((await postTeam(page, "preview", { token: oldToken })).status()).toBe(
    410,
  );
  expect((await postTeam(page, "preview", { token: newToken })).status()).toBe(
    200,
  );
  await db.installationSettings.update({
    where: { id: "installation" },
    data: {
      emailConfig: encryptSettings({
        host: "127.0.0.1",
        port: 25251,
        secure: false,
        username: "",
        password: "",
        fromEmail: "yuzu@example.test",
      }),
    },
  });
  expect(
    (
      await postTeam(page, "invite", {
        workspaceId: workspace.id,
        email: "failed@example.test",
      })
    ).status(),
  ).toBe(502);
  const failed = await db.invitation.findUniqueOrThrow({
    where: {
      workspaceId_email: {
        workspaceId: workspace.id,
        email: "failed@example.test",
      },
    },
  });
  expect(failed.sentAt).toBeNull();
  expect(failed.revokedAt).not.toBeNull();
  expect(mailbox.length).toBe(2);
});

test("invitations enforce expiry, revocation, origin, duplicate and concurrent acceptance rules", async ({
  page,
  request,
  mailbox,
}) => {
  const { workspace } = await readyTeam(page);
  expect(
    (
      await request.post("/api/v1/team/invite", {
        headers: { origin: "http://127.0.0.1:3100" },
        data: { workspaceId: workspace.id, email: "anonymous@example.test" },
      })
    ).status(),
  ).toBe(401);
  expect(
    (
      await page.request.post("/api/v1/team/invite", {
        headers: { origin: "https://untrusted.example" },
        data: { workspaceId: workspace.id, email: "outside@example.test" },
      })
    ).status(),
  ).toBe(403);
  expect(
    (
      await postTeam(page, "invite", {
        workspaceId: workspace.id,
        email: "elevate@example.test",
        role: "ADMIN",
      })
    ).status(),
  ).toBe(422);
  expect(
    (
      await postTeam(page, "invite", {
        workspaceId: workspace.id,
        email: "owner@example.test",
      })
    ).status(),
  ).toBe(409);
  expect(
    (
      await postTeam(page, "invite", {
        workspaceId: workspace.id,
        email: "revoked@example.test",
      })
    ).status(),
  ).toBe(200);
  const revokedToken = invitationToken(mailbox[0]);
  const db = getDatabase();
  const revoked = await db.invitation.findUniqueOrThrow({
    where: {
      workspaceId_email: {
        workspaceId: workspace.id,
        email: "revoked@example.test",
      },
    },
  });
  expect((await postTeam(page, "revoke", { id: revoked.id })).status()).toBe(
    200,
  );
  expect(
    (await postTeam(page, "preview", { token: revokedToken })).status(),
  ).toBe(410);
  expect(
    (
      await postTeam(page, "invite", {
        workspaceId: workspace.id,
        email: "expired@example.test",
      })
    ).status(),
  ).toBe(200);
  const expiredToken = invitationToken(mailbox[1]);
  await db.invitation.updateMany({
    where: { email: "expired@example.test" },
    data: { expiresAt: new Date(0) },
  });
  expect(
    (await postTeam(page, "preview", { token: expiredToken })).status(),
  ).toBe(410);
  expect(
    (
      await postTeam(page, "invite", {
        workspaceId: workspace.id,
        email: "race@example.test",
      })
    ).status(),
  ).toBe(200);
  const token = invitationToken(mailbox[2]);
  expect(
    (
      await request.post("/api/v1/team/accept", {
        headers: { origin: "http://127.0.0.1:3100" },
        data: {
          token,
          name: "Elevated",
          password: "member-password-123",
          role: "ADMIN",
        },
      })
    ).status(),
  ).toBe(422);
  expect(
    (
      await postTeam(page, "invite", {
        workspaceId: workspace.id,
        email: "race@example.test",
      })
    ).status(),
  ).toBe(429);
  expect(
    (
      await postTeam(page, "accept", {
        token,
        name: "Wrong session",
        password: "member-password-123",
      })
    ).status(),
  ).toBe(403);
  const results = await Promise.all(
    [1, 2].map(() =>
      request.post("/api/v1/team/accept", {
        headers: { origin: "http://127.0.0.1:3100" },
        data: { token, name: "Race Member", password: "member-password-123" },
      }),
    ),
  );
  expect(results.map((response) => response.status()).sort()).toEqual([
    200, 410,
  ]);
  expect(await db.user.count({ where: { email: "race@example.test" } })).toBe(
    1,
  );
  expect(
    await db.accessEvent.count({
      where: {
        action: "INVITATION_ACCEPTED",
        subjectEmail: "race@example.test",
      },
    }),
  ).toBe(1);
});

test("global themes persist, drafts stay scoped, modes remain personal, and previous themes restore", async ({
  page,
  browser,
}) => {
  const { board } = await readyTeam(page);
  await page.goto("/settings/appearance");
  await expect(
    page.getByRole("heading", { name: "Appearance", exact: true }),
  ).toBeVisible();
  const initialPrimary = presets[0].light.primary;
  const rootPrimary = () =>
    page.evaluate(() =>
      document.documentElement.style.getPropertyValue("--primary"),
    );
  await page.getByLabel(/Start with a preset/).selectOption("Orchid studio");
  expect(await rootPrimary()).toBe(initialPrimary);
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Draft saved." }),
  ).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Theme name")).toHaveValue("Orchid studio");
  expect(await rootPrimary()).toBe(initialPrimary);
  await page
    .getByRole("button", { name: "Publish globally", exact: true })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "revision 1" }),
  ).toBeVisible();
  expect(await rootPrimary()).toBe(presets[1].light.primary);
  await page.getByRole("switch", { name: "Dark mode" }).click();
  await expect(page.getByRole("switch", { name: "Dark mode" })).toBeChecked();
  await expect(page.getByRole("switch", { name: "Dark mode" })).toBeEnabled();
  await expect(page.locator("html")).toHaveAttribute("data-mode", "dark");
  expect(await rootPrimary()).toBe(presets[1].dark.primary);
  await page.reload();
  await expect(page.getByRole("switch", { name: "Dark mode" })).toBeChecked();
  expect(await rootPrimary()).toBe(presets[1].dark.primary);
  await page
    .getByRole("button", { name: "Restore previous", exact: true })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "revision 2" }),
  ).toBeVisible();
  expect(await rootPrimary()).toBe(presets[0].dark.primary);
  await page.goto(`/boards/${board.id}`);
  await expect(
    page.getByRole("heading", { name: "Team project", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Table", exact: true }).click();
  await expect(
    page.getByText("No sample records were created during installation."),
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "../../artifacts/phase-0.5/applied-board-mobile.png",
    fullPage: true,
  });
  const anonymous = await browser.newContext();
  const visitor = await anonymous.newPage();
  await visitor.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  await visitor.goto("/sign-in");
  await expect(visitor.locator("html")).toHaveAttribute("data-mode", "light");
  const publicTheme = await (
    await visitor.request.get("/api/v1/appearance/published")
  ).json();
  expect(Object.keys(publicTheme.data).sort()).toEqual(["revision", "theme"]);
  await expect(
    visitor.getByRole("button", { name: "Follow system theme" }),
  ).toHaveAttribute("aria-pressed", "true");
  await visitor.emulateMedia({ colorScheme: "dark" });
  await expect(visitor.locator("html")).toHaveAttribute("data-mode", "dark");
  await visitor.emulateMedia({ colorScheme: "light" });
  await expect(visitor.locator("html")).toHaveAttribute("data-mode", "light");
  await visitor.getByRole("switch", { name: "Dark mode" }).click();
  await expect(
    visitor.getByRole("switch", { name: "Dark mode" }),
  ).toBeChecked();
  await expect(
    visitor.getByRole("switch", { name: "Dark mode" }),
  ).toBeEnabled();
  await visitor.screenshot({
    path: "../../artifacts/phase-0.5/applied-sign-in-dark.png",
    fullPage: true,
  });
  await anonymous.close();
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto("/settings/appearance");
  await expect(
    page.getByRole("heading", { name: "Appearance", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: "../../artifacts/phase-0.5/applied-editor.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await expect(
    page.getByRole("button", { name: "Publish globally", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: "../../artifacts/phase-0.5/applied-editor-mobile.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page).toHaveURL(/\/sign-in$/);
  await expect(page.getByRole("switch", { name: "Dark mode" })).toBeChecked();
  await expect(page.locator("html")).toHaveAttribute("data-mode", "dark");
});

test("appearance writes reject members, malformed themes, cross-origin requests and stale revisions", async ({
  page,
  request,
}) => {
  await readyTeam(page);
  const post = (
    action: string,
    data: unknown,
    origin = "http://127.0.0.1:3100",
  ) =>
    page.request.post(`/api/v1/appearance/${action}`, {
      headers: { origin },
      data,
    });
  expect((await request.get("/api/v1/appearance/state")).status()).toBe(401);
  expect(
    (
      await post(
        "publish",
        { revision: 0, theme: presets[1] },
        "https://elsewhere.test",
      )
    ).status(),
  ).toBe(403);
  expect(
    (
      await post("publish", {
        revision: 0,
        theme: {
          ...presets[0],
          light: {
            ...presets[0].light,
            primary: "url(https://elsewhere.test)",
          },
        },
      })
    ).status(),
  ).toBe(422);
  expect(
    (await post("publish", { revision: 0, theme: presets[1] })).status(),
  ).toBe(200);
  expect(
    (await post("publish", { revision: 0, theme: presets[2] })).status(),
  ).toBe(409);
  expect(
    (await post("draft", { revision: 0, theme: presets[2] })).status(),
  ).toBe(409);
  await getDatabase().user.update({
    where: { email: "owner@example.test" },
    data: { role: "MEMBER" },
  });
  expect(
    (await post("publish", { revision: 1, theme: presets[2] })).status(),
  ).toBe(403);
  expect((await page.request.get("/api/v1/appearance/state")).status()).toBe(
    403,
  );
  await page.goto("/settings/appearance");
  await expect(
    page.getByRole("heading", {
      name: "Let's get you back to your workspace.",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Publish globally" }),
  ).toHaveCount(0);
  await page.goto("/settings");
  await expect(
    page.getByRole("link", { name: "Customize appearance" }),
  ).toHaveCount(0);
  expect(
    (await page.request.get("/api/v1/appearance/published")).status(),
  ).toBe(200);
  await getDatabase().user.update({
    where: { email: "owner@example.test" },
    data: { role: "ADMIN" },
  });
  const theme = {
    ...presets[0],
    name: "Depth verification",
    shadow: 0,
    glass: 35,
    blur: 20,
    headingFont: "Fraunces",
    bodyFont: "Manrope",
  };
  expect((await post("publish", { revision: 1, theme })).status()).toBe(200);
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Good work starts here." }),
  ).toBeVisible();
  const computed = await page.evaluate(() => ({
    blur: getComputedStyle(document.querySelector(".yuzu-topbar")!)
      .backdropFilter,
    surface: getComputedStyle(document.querySelector(".yuzu-topbar")!)
      .backgroundColor,
    shadow: getComputedStyle(document.querySelector("main .bg-card")!)
      .boxShadow,
    heading: getComputedStyle(document.querySelector("h1")!).fontFamily,
    body: getComputedStyle(document.body).fontFamily,
  }));
  expect(computed.blur).toBe("blur(20px)");
  expect(computed.surface).toContain("0.35");
  expect(computed.shadow).toBe("none");
  expect(computed.heading).toContain("Fraunces");
  expect(computed.body).toContain("Manrope");
});

test("shadcn sidebar collapses and theme switch animates with accessible fallbacks", async ({
  page,
}) => {
  await readyTeam(page);
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Good work starts here." }),
  ).toBeVisible();
  const sidebar = page.locator("[data-collapsible]");
  await expect(sidebar).toHaveAttribute("data-state", "expanded");
  await page
    .getByRole("button", { name: "Toggle navigation", exact: true })
    .click();
  await expect(sidebar).toHaveAttribute("data-state", "collapsed");
  await page.reload();
  await expect(sidebar).toHaveAttribute("data-state", "collapsed");
  await page
    .getByRole("button", { name: "Toggle navigation", exact: true })
    .click();
  await expect(sidebar).toHaveAttribute("data-state", "expanded");
  await page.keyboard.press("Control+b");
  await expect(sidebar).toHaveAttribute("data-state", "collapsed");
  await page.keyboard.press("Control+b");
  await expect(sidebar).toHaveAttribute("data-state", "expanded");
  await page.emulateMedia({
    reducedMotion: "no-preference",
    colorScheme: "light",
  });
  await page.evaluate(() => {
    const original = document.startViewTransition.bind(document);
    Object.assign(window, { themeTransitionCount: 0 });
    document.startViewTransition = ((...args: Parameters<typeof original>) => {
      Object.assign(window, {
        themeTransitionCount:
          (window as unknown as { themeTransitionCount: number })
            .themeTransitionCount + 1,
      });
      return original(...args);
    }) as typeof document.startViewTransition;
  });
  const toggle = page.getByRole("switch", { name: "Dark mode" });
  await toggle.focus();
  await page.keyboard.press("Space");
  await expect(toggle).toBeChecked();
  await expect(page.locator("html")).toHaveAttribute("data-mode", "dark");
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { themeTransitionCount: number })
            .themeTransitionCount,
      ),
    )
    .toBe(1);
  await expect(toggle).toBeEnabled();
  await expect(page.locator("html")).not.toHaveClass(/theme-ripple/);
  await page.screenshot({
    path: "../../artifacts/phase-0.5/sidebar-switch-dark.png",
    fullPage: true,
  });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await toggle.uncheck();
  await expect(page.locator("html")).toHaveAttribute("data-mode", "light");
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { themeTransitionCount: number })
          .themeTransitionCount,
    ),
  ).toBe(1);
  await page.getByRole("button", { name: "Follow system theme" }).click();
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(toggle).toBeChecked();
  await page.evaluate(() => {
    Object.defineProperty(document, "startViewTransition", {
      configurable: true,
      value: undefined,
    });
  });
  await toggle.uncheck();
  await expect(page.locator("html")).toHaveAttribute("data-mode", "light");
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .getByRole("button", { name: "Toggle navigation", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page
    .getByRole("dialog")
    .getByRole("link", { name: "Boards", exact: true })
    .click();
  await expect(page).toHaveURL(/\/boards$/);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "../../artifacts/phase-0.5/sidebar-switch-mobile.png",
    fullPage: true,
  });
});

test("reference workspace search, board lanes and details use saved structure", async ({
  page,
}) => {
  const { board } = await readyTeam(page);
  const db = getDatabase();
  await db.boardColumn.createMany({
    data: [
      {
        boardId: board.id,
        name: "Task",
        key: "name",
        type: "TEXT",
        position: 0,
      },
      {
        boardId: board.id,
        name: "Status",
        key: "status",
        type: "STATUS",
        position: 1,
        config: {
          options: [
            { label: "To do" },
            { label: "In progress" },
            { label: "Done" },
          ],
        },
      },
    ],
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Search workspace" }).click();
  await page.getByLabel("Search boards", { exact: true }).fill("Team project");
  await expect(
    page.getByRole("dialog").getByText("Restricted project", { exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("dialog")
    .getByRole("link", { name: /Team project/ })
    .click();
  await expect(page).toHaveURL(new RegExp(`/boards/${board.id}$`));
  await expect(
    page.getByRole("heading", { name: "Team project", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".board-lane")).toHaveCount(3);
  await page.getByRole("button", { name: "Filter", exact: true }).click();
  await page.getByLabel("Filter board status").selectOption("In progress");
  await expect(page.locator(".board-lane")).toHaveCount(1);
  await page.getByRole("button", { name: "Clear filter" }).click();
  await expect(page.locator(".board-lane")).toHaveCount(3);
  await page
    .getByRole("button", { name: "Board details", exact: true })
    .click();
  const panel = page.getByRole("dialog");
  await expect(
    panel.getByRole("heading", { name: "Team project", exact: true }),
  ).toBeVisible();
  await expect(
    panel
      .locator(".board-details-meta")
      .getByText("Team Owner", { exact: true }),
  ).toBeVisible();
  await expect(
    panel.locator(".board-field-list").getByText("Status", { exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: "../../artifacts/phase-0.5/reference-board-detail.png",
    fullPage: true,
  });
  await panel.getByRole("button", { name: "Back to board" }).click();
  await page.getByRole("switch", { name: "Dark mode" }).click();
  await expect(page.getByRole("switch", { name: "Dark mode" })).toBeChecked();
  await expect(page.getByRole("switch", { name: "Dark mode" })).toBeEnabled();
  await page.screenshot({
    path: "../../artifacts/phase-0.5/reference-board-dark.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page
    .getByRole("button", { name: "Board details", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.screenshot({
    path: "../../artifacts/phase-0.5/reference-board-mobile.png",
    fullPage: true,
  });
});

const postBoard = (page: Page, action: string, data: unknown) =>
  page.request.post(`/api/v1/boards/${action}`, {
    headers: { origin: "http://127.0.0.1:3100" },
    data,
  });
test("board engine creates typed tasks, shares records between views, and restores archives", async ({
  page,
}) => {
  const { workspace } = await readyTeam(page);
  await page.goto("/boards");
  await page.getByRole("button", { name: "Create board", exact: true }).click();
  await page.getByLabel("Board name", { exact: true }).fill("Release planning");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Create board", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Release planning", exact: true }),
  ).toBeVisible();
  const board = await getDatabase().board.findFirstOrThrow({
    where: { name: "Release planning", workspaceId: workspace.id },
  });
  const numberField = await postBoard(page, "field", {
    boardId: board.id,
    name: "Estimate",
    type: "NUMBER",
  });
  expect(numberField.status()).toBe(200);
  const checkboxField = await postBoard(page, "field", {
    boardId: board.id,
    name: "Reviewed",
    type: "CHECKBOX",
  });
  expect(checkboxField.status()).toBe(200);
  await page.reload();
  await page.getByRole("button", { name: "Add task", exact: true }).click();
  await page
    .getByLabel("Task name", { exact: true })
    .fill("Ship the board engine");
  await page
    .getByLabel("Task description", { exact: true })
    .fill("One task shared by table and Kanban.");
  await page.getByLabel("Task priority", { exact: true }).selectOption("HIGH");
  await page.getByLabel("Task due date", { exact: true }).fill("2026-10-25");
  await page.getByLabel("Estimate", { exact: true }).fill("0");
  await page.getByLabel("Reviewed", { exact: true }).uncheck();
  await page.getByRole("button", { name: "Create task", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Ship the board engine", exact: true }),
  ).toBeVisible();
  const doneLane = page
    .locator(".board-lane")
    .filter({ has: page.getByRole("heading", { name: "Done", exact: true }) });
  await page
    .locator(".task-card")
    .filter({
      has: page.getByRole("button", {
        name: "Ship the board engine",
        exact: true,
      }),
    })
    .getByRole("button", { name: "Drag Ship the board engine", exact: true })
    .dragTo(doneLane);
  await expect(
    doneLane.getByRole("button", {
      name: "Ship the board engine",
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.locator(".task-card")).toHaveAttribute("draggable", "true");
  await page
    .getByRole("button", { name: "Drag Ship the board engine", exact: true })
    .dragTo(
      page.locator(".board-lane").filter({
        has: page.getByRole("heading", { name: "In progress", exact: true }),
      }),
    );
  await expect(
    page
      .locator(".board-lane")
      .filter({
        has: page.getByRole("heading", { name: "In progress", exact: true }),
      })
      .getByRole("button", { name: "Ship the board engine", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Table", exact: true }).click();
  await expect(page.getByLabel("Status for Ship the board engine")).toHaveValue(
    "in_progress",
  );
  await page
    .getByLabel("Priority for Ship the board engine")
    .selectOption("URGENT");
  await expect(
    page.getByLabel("Priority for Ship the board engine"),
  ).toHaveValue("URGENT");
  // Optimistic values are visible before persistence; wait for the saving controls to unlock.
  await expect(
    page.getByLabel("Priority for Ship the board engine"),
  ).toBeEnabled();
  const stored = await getDatabase().task.findFirstOrThrow({
    where: { boardId: board.id },
    include: { values: { include: { field: true } } },
  });
  expect(
    stored.values.find((value) => value.field.name === "Estimate")?.numberValue,
  ).toBe(0);
  // Explicit false is preserved rather than collapsed into an empty value.
  const reviewed = await getDatabase().boardColumn.findFirstOrThrow({
    where: { boardId: board.id, name: "Reviewed" },
  });
  const current = await getDatabase().task.findUniqueOrThrow({
    where: { id: stored.id },
  });
  expect(
    (
      await postBoard(page, "update", {
        taskId: stored.id,
        revision: current.revision,
        changes: { fieldValues: { [reviewed.id]: false } },
      })
    ).status(),
  ).toBe(200);
  await page.reload();
  await page
    .getByRole("button", { name: "Ship the board engine", exact: true })
    .click();
  await expect(page.getByLabel("Task description")).toHaveValue(
    "One task shared by table and Kanban.",
  );
  await expect(page.getByLabel("Task priority")).toHaveValue("URGENT");
  await expect(page.getByLabel("Reviewed", { exact: true })).not.toBeChecked();
  await page.screenshot({
    path: "../../artifacts/phase-2/task-details.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Archive task", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Ship the board engine", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Archived", exact: true }).click();
  await page
    .getByRole("button", { name: "Ship the board engine", exact: true })
    .click();
  await expect(page.getByLabel("Task name")).toBeDisabled();
  await page.getByRole("button", { name: "Restore task", exact: true }).click();
  await page.getByRole("button", { name: "Active tasks", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Ship the board engine", exact: true }),
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "../../artifacts/phase-2/board-mobile.png",
    fullPage: true,
  });
});

test("task APIs enforce creator/assignee/editor rights, retries, scope and revision conflicts", async ({
  page,
  browser,
  request,
}) => {
  const { workspace, board, otherBoard } = await readyTeam(page);
  const db = getDatabase();
  const memberId = createRecordId();
  const member = await db.user.create({
    data: {
      id: memberId,
      name: "Task Member",
      email: "tasks@example.test",
      emailVerified: true,
      accounts: {
        create: {
          accountId: memberId,
          providerId: "credential",
          password: await (
            await import("better-auth/crypto")
          ).hashPassword("task-member-password-123"),
        },
      },
    },
  });
  await db.workspaceMember.create({
    data: { userId: member.id, workspaceId: workspace.id },
  });
  const context = await browser.newContext();
  const memberPage = await context.newPage();
  try {
    expect(
      (
        await memberPage.request.post("/api/v1/session/sign-in", {
          headers: { origin: "http://127.0.0.1:3100" },
          data: { email: member.email, password: "task-member-password-123" },
        })
      ).status(),
    ).toBe(200);
    const payload = {
      boardId: board.id,
      createKey: crypto.randomUUID(),
      name: "Owner-only task",
    };
    const created = await postBoard(page, "create-task", payload);
    expect(created.status()).toBe(200);
    const taskId = (await created.json()).data.taskId;
    const retries = await Promise.all([
      postBoard(page, "create-task", payload),
      postBoard(page, "create-task", payload),
    ]);
    for (const response of retries) expect(response.status()).toBe(200);
    expect(await db.task.count({ where: { id: taskId } })).toBe(1);
    expect(
      (
        await postBoard(page, "create-task", {
          ...payload,
          name: "Changed retry",
        })
      ).status(),
    ).toBe(409);
    expect(
      (await request.get(`/api/v1/boards/state?boardId=${board.id}`)).status(),
    ).toBe(401);
    expect(
      (
        await memberPage.request.get(
          `/api/v1/boards/state?boardId=${otherBoard.id}`,
        )
      ).status(),
    ).toBe(404);
    expect(
      (
        await postBoard(memberPage, "update", {
          taskId,
          revision: 1,
          changes: { name: "Unauthorized" },
        })
      ).status(),
    ).toBe(403);
    expect(
      (
        await postBoard(memberPage, "field", {
          boardId: board.id,
          name: "Forbidden field",
          type: "TEXT",
        })
      ).status(),
    ).toBe(403);
    expect(
      (
        await postBoard(memberPage, "editor", {
          taskId,
          revision: 1,
          userId: member.id,
          grant: true,
        })
      ).status(),
    ).toBe(403);
    expect(
      (
        await postBoard(page, "update", {
          taskId,
          revision: 1,
          changes: { assigneeIds: [member.id] },
        })
      ).status(),
    ).toBe(200);
    expect(
      (
        await postBoard(memberPage, "update", {
          taskId,
          revision: 2,
          changes: { description: "Assigned member edited this." },
        })
      ).status(),
    ).toBe(200);
    const race = await Promise.all([
      postBoard(page, "update", {
        taskId,
        revision: 3,
        changes: { name: "First edit" },
      }),
      postBoard(memberPage, "update", {
        taskId,
        revision: 3,
        changes: { name: "Second edit" },
      }),
    ]);
    expect(race.map((response) => response.status()).sort()).toEqual([
      200, 409,
    ]);
    expect(
      (
        await postBoard(page, "update", {
          taskId,
          revision: 4,
          changes: { assigneeIds: [] },
        })
      ).status(),
    ).toBe(200);
    expect(
      (
        await postBoard(memberPage, "update", {
          taskId,
          revision: 5,
          changes: { name: "No longer assigned" },
        })
      ).status(),
    ).toBe(403);
    expect(
      (
        await postBoard(page, "editor", {
          taskId,
          revision: 5,
          userId: member.id,
          grant: true,
        })
      ).status(),
    ).toBe(200);
    expect(
      (
        await postBoard(memberPage, "update", {
          taskId,
          revision: 6,
          changes: { name: "Explicit editor" },
        })
      ).status(),
    ).toBe(200);
    expect(
      (
        await postBoard(page, "editor", {
          taskId,
          revision: 7,
          userId: member.id,
          grant: false,
        })
      ).status(),
    ).toBe(200);
    expect(
      (
        await postBoard(memberPage, "update", {
          taskId,
          revision: 8,
          changes: { name: "Revoked editor" },
        })
      ).status(),
    ).toBe(403);
    const customPeople = await postBoard(page, "field", {
      boardId: board.id,
      name: "Reviewers",
      type: "PEOPLE",
    });
    const peopleField = (await customPeople.json()).data.id;
    expect(
      (
        await postBoard(page, "update", {
          taskId,
          revision: 8,
          changes: { fieldValues: { [peopleField]: [member.id] } },
        })
      ).status(),
    ).toBe(200);
    expect(
      (
        await postBoard(memberPage, "update", {
          taskId,
          revision: 9,
          changes: { name: "Custom people cannot edit" },
        })
      ).status(),
    ).toBe(403);
    expect(
      (
        await postBoard(memberPage, "create-task", {
          boardId: board.id,
          createKey: crypto.randomUUID(),
          name: "Member's own task",
        })
      ).status(),
    ).toBe(200);
    const outsider = await db.user.create({
      data: { name: "Outsider", email: "outsider@tasks.test" },
    });
    expect(
      (
        await postBoard(page, "update", {
          taskId,
          revision: 9,
          changes: { assigneeIds: [outsider.id] },
        })
      ).status(),
    ).toBe(422);
    expect(
      (
        await postBoard(page, "update", {
          taskId,
          revision: 9,
          changes: { statusId: "invented-status" },
        })
      ).status(),
    ).toBe(422);
    expect(
      (
        await postBoard(page, "update", {
          taskId,
          revision: 9,
          changes: { fieldValues: { [crypto.randomUUID()]: "unknown" } },
        })
      ).status(),
    ).toBe(422);
    expect(
      (
        await postBoard(page, "update", {
          taskId,
          revision: 9,
          changes: { dueDate: "2026-02-30" },
        })
      ).status(),
    ).toBe(422);
    const number = await postBoard(page, "field", {
      boardId: board.id,
      name: "Cost",
      type: "NUMBER",
    });
    const numberId = (await number.json()).data.id;
    const costField = (
      await (
        await page.request.get(`/api/v1/boards/state?boardId=${board.id}`)
      ).json()
    ).data.fields.find((field: { id: string }) => field.id === numberId);
    expect(
      (
        await postBoard(memberPage, "remove-field", {
          boardId: board.id,
          fieldId: numberId,
          version: costField.version,
        })
      ).status(),
    ).toBe(403);
    expect(
      (
        await postBoard(page, "update", {
          taskId,
          revision: 9,
          changes: { fieldValues: { [numberId]: "bad-number" } },
        })
      ).status(),
    ).toBe(422);
    expect(
      (await db.task.findUniqueOrThrow({ where: { id: taskId } })).revision,
    ).toBe(9);
    const badOrigin = await page.request.post("/api/v1/boards/update", {
      headers: { origin: "https://elsewhere.test" },
      data: { taskId, revision: 9, changes: { name: "Bad origin" } },
    });
    expect(badOrigin.status()).toBe(403);
    await db.workspaceMember.delete({
      where: {
        workspaceId_userId: { workspaceId: workspace.id, userId: member.id },
      },
    });
    expect(
      (
        await memberPage.request.get(`/api/v1/boards/state?boardId=${board.id}`)
      ).status(),
    ).toBe(404);
    expect(
      (
        await postBoard(memberPage, "create-task", {
          boardId: board.id,
          createKey: crypto.randomUUID(),
          name: "Revoked workspace",
        })
      ).status(),
    ).toBe(404);
    await db.installationSettings.update({
      where: { id: "installation" },
      data: { maintenanceMode: true },
    });
    expect(
      (
        await postBoard(page, "update", {
          taskId,
          revision: 9,
          changes: { name: "Maintenance" },
        })
      ).status(),
    ).toBe(503);
    expect(await db.taskActivity.count({ where: { taskId } })).toBe(9);
  } finally {
    await context.close();
  }
});

test("field configuration preserves option references and rejects stale board structure edits", async ({
  page,
}) => {
  const { workspace } = await readyTeam(page);
  const made = await postBoard(page, "create-board", {
    workspaceId: workspace.id,
    name: "Options test",
  });
  const boardId = (await made.json()).data.id;
  const created = await postBoard(page, "create-task", {
    boardId,
    createKey: crypto.randomUUID(),
    name: "Existing option reference",
  });
  expect(created.status()).toBe(200);
  const before = (
    await (
      await page.request.get(`/api/v1/boards/state?boardId=${boardId}`)
    ).json()
  ).data;
  const status = before.fields.find(
    (field: { key: string }) => field.key === "status",
  );
  expect(
    (
      await postBoard(page, "configure-field", {
        boardId,
        fieldId: status.id,
        version: status.version,
        name: "Status",
        options: status.options.filter(
          (option: { id: string }) => option.id !== "todo",
        ),
      })
    ).status(),
  ).toBe(409);
  const renamed = status.options.map((option: { id: string; label: string }) =>
    option.id === "todo" ? { ...option, label: "Inbox" } : option,
  );
  expect(
    (
      await postBoard(page, "configure-field", {
        boardId,
        fieldId: status.id,
        version: status.version,
        name: "Workflow",
        options: renamed,
      })
    ).status(),
  ).toBe(200);
  expect(
    (
      await postBoard(page, "configure-field", {
        boardId,
        fieldId: status.id,
        version: status.version,
        name: "Stale rename",
        options: renamed,
      })
    ).status(),
  ).toBe(409);
  const after = (
    await (
      await page.request.get(`/api/v1/boards/state?boardId=${boardId}`)
    ).json()
  ).data;
  expect(after.tasks[0].statusId).toBe("todo");
  expect(
    after.fields.find((field: { id: string }) => field.id === status.id)
      .options[0].label,
  ).toBe("Inbox");
});

test("delegated board managers stay scoped, cannot appoint managers, and lose grants immediately", async ({
  page,
  browser,
}) => {
  const { workspace, board, otherBoard } = await readyTeam(page);
  const db = getDatabase();
  const memberId = createRecordId();
  const member = await db.user.create({
    data: {
      id: memberId,
      name: "Board Manager",
      email: "manager@example.test",
      emailVerified: true,
      accounts: {
        create: {
          accountId: memberId,
          providerId: "credential",
          password: await (
            await import("better-auth/crypto")
          ).hashPassword("manager-password-123"),
        },
      },
    },
  });
  await db.workspaceMember.create({
    data: { workspaceId: workspace.id, userId: member.id },
  });
  const context = await browser.newContext();
  const managerPage = await context.newPage();
  try {
    expect(
      (
        await managerPage.request.post("/api/v1/session/sign-in", {
          headers: { origin: "http://127.0.0.1:3100" },
          data: { email: member.email, password: "manager-password-123" },
        })
      ).status(),
    ).toBe(200);
    const made = await postBoard(page, "create-task", {
      boardId: board.id,
      createKey: crypto.randomUUID(),
      name: "Managed task",
    });
    const taskId = (await made.json()).data.taskId;
    expect(
      (
        await postBoard(managerPage, "update", {
          taskId,
          revision: 1,
          changes: { name: "Denied" },
        })
      ).status(),
    ).toBe(403);
    expect(
      (
        await postBoard(page, "manager", {
          boardId: board.id,
          userId: member.id,
          grant: true,
        })
      ).status(),
    ).toBe(200);
    expect(
      (
        await postBoard(managerPage, "update", {
          taskId,
          revision: 1,
          changes: { name: "Manager can edit" },
        })
      ).status(),
    ).toBe(200);
    expect(
      (
        await postBoard(managerPage, "field", {
          boardId: board.id,
          name: "Managed field",
          type: "TEXT",
        })
      ).status(),
    ).toBe(200);
    expect(
      (
        await postBoard(managerPage, "field", {
          boardId: otherBoard.id,
          name: "Other workspace",
          type: "TEXT",
        })
      ).status(),
    ).toBe(404);
    expect(
      (
        await postBoard(managerPage, "manager", {
          boardId: board.id,
          userId: member.id,
          grant: false,
        })
      ).status(),
    ).toBe(403);
    expect(
      (
        await postBoard(managerPage, "create-board", {
          workspaceId: workspace.id,
          name: "Created by a manager",
        })
      ).status(),
    ).toBe(200);
    expect(
      (
        await postBoard(page, "manager", {
          boardId: board.id,
          userId: member.id,
          grant: false,
        })
      ).status(),
    ).toBe(200);
    expect(
      (
        await postBoard(managerPage, "update", {
          taskId,
          revision: 2,
          changes: { name: "Grant revoked" },
        })
      ).status(),
    ).toBe(403);
    expect(await db.boardEvent.count({ where: { boardId: board.id } })).toBe(2);
    await db.workspaceMember.delete({
      where: {
        workspaceId_userId: { workspaceId: workspace.id, userId: member.id },
      },
    });
    expect(
      (
        await postBoard(managerPage, "create-board", {
          workspaceId: workspace.id,
          name: "Revoked membership",
        })
      ).status(),
    ).toBe(404);
  } finally {
    await context.close();
  }
});

test("long custom text can be stored alongside a full task description", async ({
  page,
}) => {
  const { board } = await readyTeam(page);
  const field = await postBoard(page, "field", {
    boardId: board.id,
    name: "Detailed notes",
    type: "LONG_TEXT",
  });
  const fieldId = (await field.json()).data.id;
  const notes = (await import("node:crypto"))
    .randomBytes(6000)
    .toString("base64");
  const response = await postBoard(page, "create-task", {
    boardId: board.id,
    createKey: crypto.randomUUID(),
    name: "Long text storage",
    description: "d".repeat(10000),
    fieldValues: { [fieldId]: notes },
  });
  expect(response.status()).toBe(200);
  const task = await getDatabase().task.findFirstOrThrow({
    where: { name: "Long text storage" },
    include: { values: true },
  });
  expect(task.description.length).toBe(10000);
  expect(task.values[0].textValue).toBe(notes);
});

test("board moves immediately, rolls back failed saves, and exposes option order, fields and groups", async ({
  page,
}) => {
  const { workspace } = await readyTeam(page);
  const made = await postBoard(page, "create-board", {
    workspaceId: workspace.id,
    name: "Interactive board",
  });
  const boardId = (await made.json()).data.id;
  const before = (
    await (
      await page.request.get(`/api/v1/boards/state?boardId=${boardId}`)
    ).json()
  ).data;
  const created = await postBoard(page, "create-task", {
    boardId,
    createKey: crypto.randomUUID(),
    name: "Move without refreshing",
    assigneeIds: [before.currentUserId],
  });
  expect(created.status()).toBe(200);
  await page.goto(`/boards/${boardId}`);
  const lane = (name: string) =>
    page
      .locator(".board-lane")
      .filter({ has: page.getByRole("heading", { name, exact: true }) });
  const title = () =>
    page.getByRole("button", { name: "Move without refreshing", exact: true });
  await expect(title()).toBeVisible();
  await expect(page.locator(".task-avatar").first()).toHaveAttribute(
    "aria-label",
    "Team Owner",
  );
  let releaseSave!: () => void;
  const saving = new Promise<void>((resolve) => {
    releaseSave = resolve;
  });
  await page.route("**/api/v1/boards/update", async (route) => {
    await saving;
    await route.continue();
  });
  await page
    .getByRole("button", { name: "Drag Move without refreshing", exact: true })
    .dragTo(lane("In progress"));
  // The card moves while its POST is blocked, before any successful refetch.
  await expect(
    lane("In progress").getByRole("button", {
      name: "Move without refreshing",
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.locator(".task-card")).toHaveAttribute(
    "draggable",
    "false",
  );
  releaseSave();
  await expect(page.locator(".task-card")).toHaveAttribute("draggable", "true");
  await page.unroute("**/api/v1/boards/update");
  await page.route("**/api/v1/boards/update", async (route) => {
    await route.fulfill({
      status: 409,
      contentType: "application/json",
      body: JSON.stringify({
        error: {
          code: "CONFLICT",
          message: "Task changed. Refresh and try again.",
        },
        requestId: "test-conflict",
      }),
    });
  });
  await page
    .getByRole("button", { name: "Drag Move without refreshing", exact: true })
    .dragTo(lane("Done"));
  await expect(page.locator(".board-surface").getByRole("alert")).toContainText(
    "Task changed",
  );
  await expect(
    lane("In progress").getByRole("button", {
      name: "Move without refreshing",
      exact: true,
    }),
  ).toBeVisible();
  await page.unroute("**/api/v1/boards/update");
  await page
    .getByRole("button", { name: "Board details", exact: true })
    .click();
  await page.getByLabel("New field name").fill("Release link");
  await page.getByLabel("New field type").selectOption("URL");
  await page.getByRole("button", { name: "Add field", exact: true }).click();
  await expect(page.locator(".board-field-list")).toContainText("Release link");
  const statusConfiguration = page.locator("details").filter({
    has: page.locator("summary").filter({ hasText: "Status · status" }),
  });
  await statusConfiguration.locator("summary").click();
  await statusConfiguration
    .getByRole("button", { name: "Add option", exact: true })
    .click();
  await statusConfiguration
    .getByLabel("Option New option", { exact: true })
    .fill("Return");
  await statusConfiguration
    .getByRole("button", { name: "Move Return option up", exact: true })
    .click();
  await statusConfiguration
    .getByRole("button", { name: "Save field", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Add group", exact: true }),
  ).toBeEnabled();
  await page.getByLabel("New group name").fill("Sprint 1");
  await page.getByRole("button", { name: "Add group", exact: true }).click();
  await expect(page.getByLabel("Rename Sprint 1 group")).toBeVisible();
  await page
    .getByRole("button", { name: "Back to board", exact: true })
    .click();
  await expect(page.locator(".board-lane-header h2")).toHaveText([
    "To do",
    "In progress",
    "Return",
    "Done",
  ]);
  await title().click();
  await expect(page.getByLabel("Release link", { exact: true })).toBeVisible();
  await page
    .getByLabel("Task group", { exact: true })
    .selectOption({ label: "Sprint 1" });
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page
    .getByLabel("Filter task group", { exact: true })
    .selectOption({ label: "Sprint 1" });
  await expect(page.locator(".task-card-tags").first()).toContainText(
    "Sprint 1",
  );
  await page.screenshot({
    path: "../../artifacts/phase-2/board-card-controls.png",
    fullPage: true,
  });
  await page.reload();
  await expect(page.locator(".board-lane-header h2")).toHaveText([
    "To do",
    "In progress",
    "Return",
    "Done",
  ]);
  await page
    .getByRole("button", {
      name: "Archive Move without refreshing",
      exact: true,
    })
    .click();
  await expect(title()).toHaveCount(0);
  await page.getByRole("button", { name: "Archived", exact: true }).click();
  await expect(title()).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: "Drag Move without refreshing",
      exact: true,
    }),
  ).toHaveCount(0);
});

test("existing auth IDs refresh correctly, whole cards open sheets and drag, tags stack, and removed fields preserve data", async ({
  page,
}) => {
  const { workspace } = await readyTeam(page);
  const db = getDatabase();
  const owner = await db.user.findUniqueOrThrow({
    where: { email: "owner@example.test" },
  });
  const legacyId = "existingAuthIdentity_before_uuid";
  await db.user.update({ where: { id: owner.id }, data: { id: legacyId } });
  await db.account.updateMany({
    where: { userId: legacyId, providerId: "credential" },
    data: { accountId: legacyId },
  });
  const member = await db.user.create({
    data: {
      name: "Another Assignee",
      email: "assignee@example.test",
      role: "MEMBER",
      memberships: { create: { workspaceId: workspace.id } },
    },
  });
  const made = await postBoard(page, "create-board", {
    workspaceId: workspace.id,
    name: "Existing identities",
  });
  expect(made.status()).toBe(200);
  const boardId = (await made.json()).data.id;
  const created = await postBoard(page, "create-task", {
    boardId,
    createKey: crypto.randomUUID(),
    name: "Card interactions",
    description: "Click this card body",
    assigneeIds: [legacyId, member.id],
  });
  expect(created.status()).toBe(200);
  const taskId = (await created.json()).data.taskId;
  await page.goto(`/boards/${boardId}`);
  await page
    .getByRole("button", { name: "Board details", exact: true })
    .click();
  await page.getByLabel("New field name").fill("Labels");
  await page.getByLabel("New field type").selectOption("TAGS");
  await page.getByLabel("Field options").fill("Design, Backend, Urgent");
  await page.getByRole("button", { name: "Add field", exact: true }).click();
  await expect(page.locator('[data-slot="board-notification"]')).toContainText(
    "Custom field added",
  );
  await expect(page.locator(".board-field-list")).toContainText("Labels");
  await page.getByLabel("New field name").fill("Checks");
  await page.getByLabel("New field type").selectOption("MULTI_SELECT");
  await page.getByLabel("Field options").fill("Stage A, Stage B, Stage C");
  await page.getByRole("button", { name: "Add field", exact: true }).click();
  await expect(page.locator(".board-field-list")).toContainText("Checks");
  await page
    .getByRole("button", { name: "Back to board", exact: true })
    .click();
  const card = page.locator(".task-card").filter({
    has: page.getByRole("button", { name: "Card interactions", exact: true }),
  });
  await expect(card.locator(".task-avatar")).toHaveCount(2);
  const avatars = await card.locator(".task-avatar").evaluateAll((elements) =>
    elements.map((element) => ({
      left: element.getBoundingClientRect().left,
      right: element.getBoundingClientRect().right,
    })),
  );
  expect(avatars[1]!.left).toBeLessThan(avatars[0]!.right);
  const handle = await card
    .getByRole("button", { name: "Drag Card interactions", exact: true })
    .boundingBox();
  const archive = await card
    .getByRole("button", { name: "Archive Card interactions", exact: true })
    .boundingBox();
  expect(handle!.x).toBeLessThan(archive!.x);
  await card.getByText("Click this card body", { exact: true }).click();
  await expect(page.locator('[data-slot="sheet-content"]')).toBeVisible();
  await page.getByRole("button", { name: "Design", exact: true }).click();
  await page.getByRole("button", { name: "Backend", exact: true }).click();
  await expect(
    page
      .getByRole("group", { name: "Labels", exact: true })
      .getByRole("checkbox"),
  ).toHaveCount(0);
  const checks = page.getByRole("group", { name: "Checks", exact: true });
  await expect(checks.getByRole("checkbox")).toHaveCount(3);
  await checks.getByRole("checkbox", { name: "Stage A", exact: true }).check();
  await page.screenshot({
    path: "../../artifacts/phase-2/task-tag-picker.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator('[data-slot="board-notification"]')).toContainText(
    "Task updated",
  );
  await expect(card.locator(".task-custom-tags")).toContainText("Design");
  await expect(card.locator(".task-custom-tags")).toContainText("Backend");
  await expect(card.locator(".task-custom-tags")).not.toContainText("Stage A");
  await expect(card.locator(".task-checklist-summary")).toContainText(
    "Checks1/3",
  );
  await page.screenshot({
    path: "../../artifacts/phase-2/stacked-avatars-and-tags.png",
    fullPage: true,
  });
  const doneLane = page
    .locator(".board-lane")
    .filter({ has: page.getByRole("heading", { name: "Done", exact: true }) });
  // Drag from the entire article, rather than its dedicated handle.
  await card.dragTo(doneLane);
  await expect(
    doneLane.getByRole("button", { name: "Card interactions", exact: true }),
  ).toBeVisible();
  await expect(card).toHaveAttribute("draggable", "true");
  await expect(page.locator(".board-surface").getByRole("alert")).toHaveCount(
    0,
  );
  const snapshot = (
    await (
      await page.request.get(`/api/v1/boards/state?boardId=${boardId}`)
    ).json()
  ).data;
  const status = snapshot.fields.find(
    (field: { key: string }) => field.key === "status",
  );
  expect(
    (
      await postBoard(page, "remove-field", {
        boardId,
        fieldId: status.id,
        version: status.version,
      })
    ).status(),
  ).toBe(422);
  const labels = snapshot.fields.find(
    (field: { name: string }) => field.name === "Labels",
  );
  const savedTask = snapshot.tasks.find(
    (task: { id: string }) => task.id === taskId,
  );
  expect(
    (
      await postBoard(page, "update", {
        taskId,
        revision: savedTask.revision,
        changes: { fieldValues: { [labels.id]: ["not-a-saved-tag"] } },
      })
    ).status(),
  ).toBe(422);
  expect(
    (
      await postBoard(page, "configure-field", {
        boardId,
        fieldId: labels.id,
        version: labels.version,
        name: labels.name,
        options: labels.options.filter(
          (option: { label: string }) => option.label !== "Design",
        ),
      })
    ).status(),
  ).toBe(409);

  await page
    .getByRole("button", { name: "Board details", exact: true })
    .click();
  const configuration = page.locator("details").filter({
    has: page.locator("summary").filter({ hasText: "Labels · tags" }),
  });
  await configuration.locator("summary").click();
  // Another editor changes metadata while this sheet is open; removal must reject that stale version.
  await db.boardColumn.update({
    where: { id: labels.id },
    data: { name: "Updated labels" },
  });
  await configuration
    .getByRole("button", { name: "Remove field", exact: true })
    .click();
  await expect(page.locator('[data-slot="board-notification"]')).toContainText(
    "This field changed",
  );
  await expect(
    page.getByRole("button", { name: "Back to board", exact: true }),
  ).toBeEnabled();
  await page
    .getByRole("button", { name: "Back to board", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Board details", exact: true })
    .click();
  const updatedConfiguration = page.locator("details").filter({
    has: page.locator("summary").filter({ hasText: "Updated labels · tags" }),
  });
  await updatedConfiguration.locator("summary").click();
  await updatedConfiguration
    .getByRole("button", { name: "Remove field", exact: true })
    .click();
  await expect(page.locator('[data-slot="board-notification"]')).toContainText(
    "Field removed",
  );
  await expect(page.locator(".board-field-list")).not.toContainText(
    "Updated labels",
  );
  await page
    .getByRole("button", { name: "Back to board", exact: true })
    .click();
  await expect(card.locator(".task-custom-tags")).not.toContainText("Design");
  const preserved = await db.taskFieldValue.findFirstOrThrow({
    where: { taskId, fieldId: labels.id },
  });
  expect(preserved.choices).toHaveLength(2);
  await card.getByText("Click this card body", { exact: true }).click();
  await expect(
    page
      .getByRole("group", { name: "Checks", exact: true })
      .getByRole("checkbox", { name: "Stage A", exact: true }),
  ).toBeChecked();
  await expect(page.getByLabel("Updated labels", { exact: true })).toHaveCount(
    0,
  );
  await page.screenshot({
    path: "../../artifacts/phase-2/card-sheet-and-tags.png",
    fullPage: true,
  });
});

test("task reference sheet persists option appearance, formats dates and shows real comments", async ({
  page,
}) => {
  const { workspace } = await readyTeam(page);
  const made = await postBoard(page, "create-board", {
    workspaceId: workspace.id,
    name: "Product development",
  });
  const boardId = (await made.json()).data.id;
  const tag = await postBoard(page, "field", {
    boardId,
    name: "Tags",
    type: "TAGS",
    options: ["Development", "Feature"],
  });
  const tagId = (await tag.json()).data.id;
  const checklist = await postBoard(page, "field", {
    boardId,
    name: "Checklist",
    type: "MULTI_SELECT",
    options: ["Set up project", "Build board", "Review changes"],
  });
  const checklistId = (await checklist.json()).data.id;
  const before = (
    await (
      await page.request.get(`/api/v1/boards/state?boardId=${boardId}`)
    ).json()
  ).data;
  const tagField = before.fields.find(
    (field: { id: string }) => field.id === tagId,
  );
  const checklistField = before.fields.find(
    (field: { id: string }) => field.id === checklistId,
  );
  const madeTask = await postBoard(page, "create-task", {
    boardId,
    createKey: crypto.randomUUID(),
    name: "Develop core features",
    description: "Build the features our team needs to plan and ship together.",
    statusId: "in_progress",
    priority: "HIGH",
    dueDate: "2026-04-16",
    assigneeIds: [before.currentUserId],
    fieldValues: {
      [tagId]: [tagField.options[0].id],
      [checklistId]: [checklistField.options[0].id],
    },
  });
  const taskId = (await madeTask.json()).data.taskId;
  await page.goto(`/boards/${boardId}`);
  await page
    .getByRole("button", { name: "Board details", exact: true })
    .click();
  const setColor = async (label: string, color: string) => {
    await page.getByLabel(label, { exact: true }).evaluate((element, color) => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!.call(element, color);
      element.dispatchEvent(new Event("input", { bubbles: true }));
      element.dispatchEvent(new Event("change", { bubbles: true }));
    }, color);
  };
  const configuration = (summary: string) =>
    page
      .locator("details")
      .filter({ has: page.locator("summary").filter({ hasText: summary }) });
  const tags = configuration("Tags · tags");
  await tags.locator("summary").click();
  await setColor("Tags Development color", "#a855f7");
  await tags.getByRole("button", { name: "Save field", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Add field", exact: true }),
  ).toBeEnabled();
  const status = configuration("Status · status");
  await status.locator("summary").click();
  await setColor("Status In progress color", "#0ea5e9");
  await page
    .getByLabel("Status In progress icon", { exact: true })
    .selectOption("clock");
  await status.getByRole("button", { name: "Save field", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Add field", exact: true }),
  ).toBeEnabled();
  const priority = configuration("Priority · priority");
  await priority.locator("summary").click();
  await setColor("Priority High color", "#f59e0b");
  await priority
    .getByRole("button", { name: "Save field", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Add field", exact: true }),
  ).toBeEnabled();
  await page
    .getByRole("button", { name: "Back to board", exact: true })
    .click();
  const card = page.locator(".task-card").filter({
    has: page.getByRole("button", {
      name: "Develop core features",
      exact: true,
    }),
  });
  await expect(card.locator(".task-custom-tags > span")).toHaveText(
    "Development",
  );
  await expect(card.locator(".task-custom-tags > span")).toHaveCSS(
    "background-color",
    "rgb(168, 85, 247)",
  );
  await expect(
    card.locator(".task-card-tags > span").filter({ hasText: "High" }),
  ).toHaveCSS("background-color", "rgb(245, 158, 11)");
  await expect(card.getByText("Apr 16", { exact: true })).toBeVisible();
  await expect(card.locator("select")).toHaveCount(0);
  await expect(card.locator(".task-card-heading .task-card-date")).toHaveText(
    "Apr 16",
  );
  const avatarBounds = await card.locator(".task-avatar").first().boundingBox();
  const commentBounds = await card.locator(".task-comment-count").boundingBox();
  expect(avatarBounds!.x).toBeLessThan(commentBounds!.x);
  await card.locator(".task-avatar").first().hover();
  await expect(page.getByRole("tooltip")).toContainText("Team Owner");
  await page.mouse.move(0, 0);
  await page.screenshot({
    path: "../../artifacts/phase-2/clean-task-card.png",
    fullPage: true,
  });

  await expect(
    card.getByText("Apr 16", { exact: true }).locator("svg"),
  ).toHaveCount(1);
  await expect(
    page
      .locator(".board-lane-header")
      .filter({ hasText: "In progress" })
      .locator(".lucide-clock"),
  ).toHaveCount(1);
  await card
    .getByRole("button", { name: "Develop core features", exact: true })
    .click();
  await expect(
    page.getByRole("tab", { name: "Details", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".task-sheet-header")).toContainText(
    "Apr 16, 2026",
  );
  await expect(page.locator(".task-sheet-header .lucide-clock")).toHaveCount(1);
  await expect(
    page.getByRole("progressbar", { name: "Checklist progress" }),
  ).toHaveAttribute("value", "1");
  await page.screenshot({
    path: "../../artifacts/phase-2/reference-task-sheet.png",
    fullPage: true,
  });
  await page.getByRole("tab", { name: "Comments 0", exact: true }).click();
  await page
    .getByLabel("New comment", { exact: true })
    .fill("Ready for review. <b>Plain text</b>");
  await page.getByRole("button", { name: "Post comment", exact: true }).click();
  await expect(page.locator('[data-slot="board-notification"]')).toContainText(
    "Comment added",
  );
  await expect(
    page.getByRole("tab", { name: "Comments 1", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".task-comment-list p")).toHaveText(
    "Ready for review. <b>Plain text</b>",
  );
  await expect(page.locator(".task-comment-list p b")).toHaveCount(0);
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await expect(
    card.getByRole("button", {
      name: "Comments for Develop core features",
      exact: true,
    }),
  ).toHaveText("1");
  await card
    .getByRole("button", {
      name: "Comments for Develop core features",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("tab", { name: "Comments 1", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".task-comment-list p")).toContainText(
    "Ready for review",
  );
  await page.screenshot({
    path: "../../artifacts/phase-2/task-comments.png",
    fullPage: true,
  });
  const fresh = (
    await (
      await page.request.get(`/api/v1/boards/state?boardId=${boardId}`)
    ).json()
  ).data;
  expect(
    fresh.fields.find((field: { id: string }) => field.id === tagId).options[0]
      .color,
  ).toBe("#a855f7");
  const statusField = fresh.fields.find(
    (field: { key: string }) => field.key === "status",
  );
  expect(
    (
      await postBoard(page, "configure-field", {
        boardId,
        fieldId: statusField.id,
        version: statusField.version,
        name: statusField.name,
        options: statusField.options.map((option: { id: string }) => ({
          ...option,
          color: "url(javascript:alert(1))",
        })),
      })
    ).status(),
  ).toBe(422);
  expect(await getDatabase().taskComment.count({ where: { taskId } })).toBe(1);
  await page.getByRole("tab", { name: "Comments 1", exact: true }).focus();
  await page
    .getByRole("tab", { name: "Comments 1", exact: true })
    .press("ArrowRight");
  await expect(
    page.getByRole("tab", { name: "Activity", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await page.getByRole("tab", { name: "Activity", exact: true }).press("Home");
  await expect(
    page.getByRole("tab", { name: "Details", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.locator(".task-sheet-body").evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await expect(page.locator(".task-sheet-header")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Save changes", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: "../../artifacts/phase-2/reference-task-sheet-mobile.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByRole("button", { name: "Add task", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Create task", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close", exact: true }).click();
});

test("comments enforce board membership, archived state, maintenance and retry identity", async ({
  page,
  browser,
}) => {
  const { workspace, board, otherBoard } = await readyTeam(page);
  const db = getDatabase();
  const created = await postBoard(page, "create-task", {
    boardId: board.id,
    createKey: crypto.randomUUID(),
    name: "Shared conversation",
  });
  const taskId = (await created.json()).data.taskId;
  const foreign = await postBoard(page, "create-task", {
    boardId: otherBoard.id,
    createKey: crypto.randomUUID(),
    name: "Private conversation",
  });
  const foreignId = (await foreign.json()).data.taskId;
  const memberId = createRecordId();
  const member = await db.user.create({
    data: {
      id: memberId,
      name: "Commenter",
      email: "commenter@example.test",
      role: "MEMBER",
      emailVerified: true,
      accounts: {
        create: {
          accountId: memberId,
          providerId: "credential",
          password: await (
            await import("better-auth/crypto")
          ).hashPassword("commenter-password-123"),
        },
      },
      memberships: { create: { workspaceId: workspace.id } },
    },
  });
  const context = await browser.newContext();
  const memberPage = await context.newPage();
  try {
    expect(
      (
        await memberPage.request.post("/api/v1/session/sign-in", {
          headers: { origin: "http://127.0.0.1:3100" },
          data: { email: member.email, password: "commenter-password-123" },
        })
      ).status(),
    ).toBe(200);
    const input = {
      taskId,
      createKey: crypto.randomUUID(),
      body: "A member can discuss a task without editing its data.",
    };
    const [one, two] = await Promise.all([
      postBoard(memberPage, "comment", input),
      postBoard(memberPage, "comment", input),
    ]);
    expect(one.status()).toBe(200);
    expect(two.status()).toBe(200);
    expect(await db.taskComment.count({ where: { taskId } })).toBe(1);
    expect(
      (await db.task.findUniqueOrThrow({ where: { id: taskId } })).revision,
    ).toBe(1);
    expect(
      (
        await postBoard(memberPage, "comment", {
          ...input,
          body: "Changed retry payload",
        })
      ).status(),
    ).toBe(409);
    expect(
      (
        await memberPage.request.get(
          `/api/v1/boards/comments?taskId=${foreignId}`,
        )
      ).status(),
    ).toBe(404);
    expect(
      (
        await postBoard(memberPage, "comment", {
          ...input,
          taskId: foreignId,
          createKey: crypto.randomUUID(),
        })
      ).status(),
    ).toBe(404);
    expect(
      (
        await postBoard(memberPage, "comment", {
          ...input,
          createKey: crypto.randomUUID(),
          body: " ",
        })
      ).status(),
    ).toBe(422);
    await postBoard(page, "archive", { taskId, revision: 1 });
    expect(
      (
        await postBoard(memberPage, "comment", {
          ...input,
          createKey: crypto.randomUUID(),
        })
      ).status(),
    ).toBe(409);
    expect(
      (
        await memberPage.request.get(`/api/v1/boards/comments?taskId=${taskId}`)
      ).status(),
    ).toBe(200);
    await postBoard(page, "restore", { taskId, revision: 2 });
    await db.installationSettings.update({
      where: { id: "installation" },
      data: { maintenanceMode: true },
    });
    expect(
      (
        await postBoard(memberPage, "comment", {
          ...input,
          createKey: crypto.randomUUID(),
        })
      ).status(),
    ).toBe(503);
    await db.installationSettings.update({
      where: { id: "installation" },
      data: { maintenanceMode: false },
    });
    await db.workspaceMember.delete({
      where: {
        workspaceId_userId: { workspaceId: workspace.id, userId: memberId },
      },
    });
    expect(
      (
        await memberPage.request.get(`/api/v1/boards/comments?taskId=${taskId}`)
      ).status(),
    ).toBe(404);
    expect(
      (
        await postBoard(memberPage, "comment", {
          ...input,
          createKey: crypto.randomUUID(),
        })
      ).status(),
    ).toBe(404);
  } finally {
    await context.close();
  }
});

test("Yuzu toast design uses citrus assets, accessible actions, progress, dismissal and theme modes", async ({
  page,
}) => {
  await readyTeam(page);
  await page.goto("/design/toasts");
  await expect(
    page.getByRole("heading", { name: "Yuzu notifications" }),
  ).toBeVisible();
  await expect(page.locator(".toast-preview-grid .yuzu-toast")).toHaveCount(9);
  await page.getByRole("button", { name: "Show success", exact: true }).click();
  const notification = page.locator('[data-slot="board-notification"]');
  await expect(notification).toHaveAttribute("data-variant", "success");
  await expect(notification.locator(".yuzu-toast-leaf")).toHaveCSS(
    "background-image",
    /yuzu-leaf-corner.svg/,
  );
  await expect(notification.locator(".yuzu-toast-lemon")).toHaveCSS(
    "background-image",
    /yuzu-lemon-slice.svg/,
  );
  const position = await notification.boundingBox();
  expect(position!.y).toBeLessThan(80);
  await page
    .getByRole("button", { name: "Dismiss notification", exact: true })
    .click();
  await expect(notification).toHaveCount(0);
  await page.getByRole("button", { name: "Show action", exact: true }).click();
  await notification
    .getByRole("button", { name: "Try action", exact: true })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "Preview action completed" }),
  ).toBeVisible();
  await expect(notification).toHaveCount(0);
  await page.getByRole("button", { name: "Show loading", exact: true }).click();
  await expect(notification.getByRole("progressbar")).toHaveAttribute(
    "value",
    "26",
  );
  await page
    .getByRole("button", { name: "Advance progress", exact: true })
    .click();
  await expect(notification.getByRole("progressbar")).toHaveAttribute(
    "value",
    "75",
  );
  await page
    .getByRole("button", { name: "Dismiss notification", exact: true })
    .click();
  await page.getByLabel("Toast duration", { exact: true }).selectOption("2000");
  await page.getByRole("button", { name: "Show neutral", exact: true }).click();
  await expect(notification).toBeVisible();
  await page.mouse.move(0, 0);
  await expect(notification).toHaveCount(0, { timeout: 6000 });
  await page.screenshot({
    path: "../../artifacts/phase-2/toast-light.png",
    fullPage: true,
  });
  await page.getByRole("switch", { name: "Dark mode", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-mode", "dark");
  await expect(page.locator("html")).not.toHaveClass(/theme-ripple/);
  await page.screenshot({
    path: "../../artifacts/phase-2/toast-dark.png",
    fullPage: true,
  });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.getByRole("button", { name: "Show error", exact: true }).click();
  await expect(notification).toHaveCSS("animation-name", "none");
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "../../artifacts/phase-2/toast-mobile.png",
    fullPage: true,
  });
});

test("boards sync across people, preserve drafts and recover concurrent non-overlapping saves", async ({
  page,
  browser,
}) => {
  test.setTimeout(90_000);
  const { workspace, otherBoard } = await readyTeam(page);
  const db = getDatabase();
  const id = createRecordId();
  const member = await db.user.create({
    data: {
      id,
      name: "Live Member",
      email: "live@example.test",
      emailVerified: true,
      accounts: {
        create: {
          accountId: id,
          providerId: "credential",
          password: await (
            await import("better-auth/crypto")
          ).hashPassword("live-member-password-123"),
        },
      },
    },
  });
  await db.workspaceMember.create({
    data: { userId: id, workspaceId: workspace.id },
  });
  const made = await postBoard(page, "create-board", {
    workspaceId: workspace.id,
    name: "Live team board",
  });
  const boardId = (await made.json()).data.id;
  const before = (
    await (
      await page.request.get(`/api/v1/boards/state?boardId=${boardId}`)
    ).json()
  ).data;
  const created = await postBoard(page, "create-task", {
    boardId,
    createKey: crypto.randomUUID(),
    name: "Collaborative card",
    description: "Original",
    assigneeIds: [before.currentUserId, id],
  });
  expect(created.status()).toBe(200);
  const taskId = (await created.json()).data.taskId;
  const context = await browser.newContext();
  const teammate = await context.newPage();
  await teammate.clock.install();
  let blockConnections = false;
  let closeOwnerSocket: (() => void) | undefined;
  await page.routeWebSocket(/127\.0\.0\.1:3101\/socket\.io/, (socket) => {
    if (blockConnections) {
      socket.close();
      return;
    }
    closeOwnerSocket = () => socket.close();
    socket.connectToServer();
  });
  const lane = (target: Page, name: string) =>
    target
      .locator(".board-lane")
      .filter({ has: target.getByRole("heading", { name, exact: true }) });
  const remote = async (changes: unknown) => {
    const current = await db.task.findUniqueOrThrow({ where: { id: taskId } });
    expect(
      (
        await postBoard(teammate, "update", {
          taskId,
          revision: current.revision,
          changes,
        })
      ).status(),
    ).toBe(200);
  };
  try {
    expect(
      (
        await teammate.request.post("/api/v1/realtime/authorize", {
          headers: { origin: "http://127.0.0.1:3100" },
          data: { boardId },
        })
      ).status(),
    ).toBe(401);
    expect(
      (
        await teammate.request.post("/api/v1/session/sign-in", {
          headers: { origin: "http://127.0.0.1:3100" },
          data: { email: member.email, password: "live-member-password-123" },
        })
      ).status(),
    ).toBe(200);
    expect(
      (
        await teammate.request.post("/api/v1/realtime/authorize", {
          headers: { origin: "http://127.0.0.1:3100" },
          data: { boardId: otherBoard.id },
        })
      ).status(),
    ).toBe(404);
    expect(
      (
        await teammate.request.post("/api/v1/realtime/authorize", {
          headers: { origin: "https://untrusted.test" },
          data: { boardId },
        })
      ).status(),
    ).toBe(403);
    await page.goto(`/boards/${boardId}`);
    await teammate.goto(`/boards/${boardId}`);
    await expect(page.locator(".board-surface")).toHaveAttribute(
      "data-connection",
      "live",
    );
    await expect(teammate.locator(".board-surface")).toHaveAttribute(
      "data-connection",
      "live",
    );
    await teammate
      .getByRole("button", { name: "Collaborative card", exact: true })
      .click();
    expect(
      (
        await postBoard(page, "field", {
          boardId,
          name: "Live field",
          type: "TEXT",
        })
      ).status(),
    ).toBe(200);
    await expect(
      teammate.getByLabel("Live field", { exact: true }),
    ).toBeVisible();
    await teammate.getByRole("button", { name: "Close", exact: true }).click();
    await lane(teammate, "To do")
      .locator(".task-card")
      .dragTo(lane(teammate, "In progress"));
    await expect(lane(page, "In progress").locator(".task-card")).toContainText(
      "Collaborative card",
      { timeout: 10_000 },
    );
    await page
      .getByRole("button", {
        name: "Collaborative card",
        exact: true,
      })
      .click();
    await page.getByLabel("Task description").fill("My unsaved notes");
    // No navigation/focus/reload on the viewing page: interval sync must update an open sheet.
    await remote({ statusId: "done" });
    await expect(page.getByLabel("Task status")).toHaveValue("done", {
      timeout: 10_000,
    });
    await expect(page.getByLabel("Task description")).toHaveValue(
      "My unsaved notes",
    );
    await page
      .getByRole("button", { name: "Save changes", exact: true })
      .click();
    await expect(
      page.locator('[data-slot="board-notification"]'),
    ).toContainText("Task updated");
    expect(
      await db.task.findUniqueOrThrow({ where: { id: taskId } }),
    ).toMatchObject({ statusId: "done", description: "My unsaved notes" });
    await expect(lane(teammate, "Done").locator(".task-card")).toHaveCount(1, {
      timeout: 10_000,
    });

    await page
      .getByRole("button", {
        name: "Collaborative card",
        exact: true,
      })
      .click();
    await page.getByRole("tab", { name: /Comments/ }).click();
    expect(
      (
        await postBoard(teammate, "comment", {
          taskId,
          createKey: crypto.randomUUID(),
          body: "A live teammate comment",
        })
      ).status(),
    ).toBe(200);
    await expect(page.locator(".task-comment-list")).toContainText(
      "A live teammate comment",
      { timeout: 10_000 },
    );
    await page.getByRole("tab", { name: "Details", exact: true }).click();
    await page.getByLabel("Task description").fill("My conflicting notes");
    await remote({ description: "Teammate's notes" });
    await expect(
      page.getByRole("status", { name: "Task edit conflict" }),
    ).toContainText("Description", { timeout: 10_000 });
    await expect(page.getByLabel("Task description")).toHaveValue(
      "My conflicting notes",
    );
    await expect(
      page.getByRole("button", { name: "Save changes", exact: true }),
    ).toBeDisabled();
    expect(
      (await db.task.findUniqueOrThrow({ where: { id: taskId } })).description,
    ).toBe("Teammate's notes");
    await page
      .getByRole("button", { name: "Keep my edits", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Save changes", exact: true })
      .click();
    await expect(page.getByLabel("Task description")).toHaveCount(0);
    expect(
      (await db.task.findUniqueOrThrow({ where: { id: taskId } })).description,
    ).toBe("My conflicting notes");

    // Force a race after the user clicks Save; a disjoint edit should retry safely once.
    await page
      .getByRole("button", {
        name: "Collaborative card",
        exact: true,
      })
      .click();
    await page.getByLabel("Task description").fill("Saved through a race");
    let requests = 0;
    await page.route("**/api/v1/boards/update", async (route) => {
      requests++;
      if (requests === 1) await remote({ priority: "HIGH" });
      expect(Object.keys(route.request().postDataJSON().changes)).toEqual([
        "description",
      ]);
      await route.continue();
    });
    await page
      .getByRole("button", { name: "Save changes", exact: true })
      .click();
    await expect(page.getByLabel("Task description")).toHaveCount(0);
    expect(requests).toBe(2);
    expect(
      await db.task.findUniqueOrThrow({ where: { id: taskId } }),
    ).toMatchObject({ description: "Saved through a race", priority: "HIGH" });
    await page.unroute("**/api/v1/boards/update");

    // A disconnected viewer catches missed events by refetching after reconnection.
    blockConnections = true;
    closeOwnerSocket!();
    await expect(page.locator(".board-surface")).toHaveAttribute(
      "data-connection",
      "reconnecting",
    );
    await remote({ name: "Recovered collaborative card" });
    blockConnections = false;
    await expect(page.locator(".board-surface")).toHaveAttribute(
      "data-connection",
      "live",
      { timeout: 10_000 },
    );
    await expect(
      page.getByRole("button", {
        name: "Recovered collaborative card",
        exact: true,
      }),
    ).toBeVisible();
    await remote({ name: "Collaborative card" });
    await expect(
      page.getByRole("button", { name: "Collaborative card", exact: true }),
    ).toBeVisible();

    // Choosing the latest version is explicit and resets the form without saving old values.
    await page
      .getByRole("button", {
        name: "Collaborative card",
        exact: true,
      })
      .click();
    await page.getByLabel("Task description").fill("Discard this draft");
    await remote({ description: "Keep teammate's version" });
    await expect(
      page.getByRole("status", { name: "Task edit conflict" }),
    ).toBeVisible({ timeout: 10_000 });
    await page
      .getByRole("button", { name: "Load latest task", exact: true })
      .click();
    await expect(page.getByLabel("Task description")).toHaveValue(
      "Keep teammate's version",
    );
    await expect(
      page.getByRole("button", { name: "Save changes", exact: true }),
    ).toBeDisabled();
    await remote({ description: "New visible notes" });
    await expect(page.getByLabel("Task description")).toHaveValue(
      "New visible notes",
      { timeout: 10_000 },
    );
    await page.getByLabel("Task description").fill("Editing the visible notes");
    await expect(
      page.getByRole("status", { name: "Task edit conflict" }),
    ).toHaveCount(0);
    await page
      .getByRole("button", { name: "Save changes", exact: true })
      .click();
    await expect(page.getByLabel("Task description")).toHaveCount(0);
    expect(
      (await db.task.findUniqueOrThrow({ where: { id: taskId } })).description,
    ).toBe("Editing the visible notes");
    // Ticket renewal rechecks current membership rather than extending cached access.
    await db.workspaceMember.delete({
      where: { workspaceId_userId: { workspaceId: workspace.id, userId: id } },
    });
    expect(
      (
        await teammate.request.post("/api/v1/realtime/authorize", {
          headers: { origin: "http://127.0.0.1:3100" },
          data: { boardId },
        })
      ).status(),
    ).toBe(404);
    await teammate.clock.fastForward(31_000);
    await expect(teammate.locator(".board-surface")).toHaveAttribute(
      "data-connection",
      "fallback",
    );
  } finally {
    await context.close();
  }
});

const postApproval = (page: Page, action: string, input: unknown) =>
  page.request.post(`/api/v1/approvals/${action}`, {
    headers: { origin: "http://127.0.0.1:3100" },
    data: input,
  });
const readInbox = async (page: Page, suffix = "") =>
  (
    await (
      await page.request.get(`/api/v1/notifications/inbox${suffix}`)
    ).json()
  ).data;
const changeInbox = (
  page: Page,
  input: unknown,
  origin = "http://127.0.0.1:3100",
) =>
  page.request.post("/api/v1/notifications/change", {
    headers: { origin },
    data: input,
  });
async function approvalTeam(
  page: Page,
  browser: import("@playwright/test").Browser,
) {
  const { workspace } = await readyTeam(page);
  const made = await postBoard(page, "create-board", {
    workspaceId: workspace.id,
    name: "Approval project",
  });
  const boardId = (await made.json()).data.id;
  const db = getDatabase();
  const actors: {
    id: string;
    page: Page;
    context: import("@playwright/test").BrowserContext;
  }[] = [];
  for (const name of ["Request Author", "Backup Reviewer"]) {
    const id = createRecordId();
    const email = `${name.toLowerCase().replaceAll(" ", "-")}@approval.test`;
    await db.user.create({
      data: {
        id,
        name,
        email,
        emailVerified: true,
        accounts: {
          create: {
            accountId: id,
            providerId: "credential",
            password: await (
              await import("better-auth/crypto")
            ).hashPassword("approval-test-password-123"),
          },
        },
      },
    });
    await db.workspaceMember.create({
      data: { workspaceId: workspace.id, userId: id },
    });
    const context = await browser.newContext();
    const actorPage = await context.newPage();
    expect(
      (
        await actorPage.request.post("/api/v1/session/sign-in", {
          headers: { origin: "http://127.0.0.1:3100" },
          data: { email, password: "approval-test-password-123" },
        })
      ).status(),
    ).toBe(200);
    actors.push({ id, page: actorPage, context });
  }
  const state = async () =>
    (
      await (
        await page.request.get(`/api/v1/boards/state?boardId=${boardId}`)
      ).json()
    ).data;
  const ownerId = (await state()).currentUserId;
  const configure = async (changes: Record<string, unknown> = {}) => {
    const current = await state();
    return postApproval(page, "configure", {
      ...current.approvalPolicy,
      boardId,
      enabled: true,
      primaryApproverId: ownerId,
      backupApproverId: actors[1]!.id,
      ...changes,
    });
  };
  return {
    boardId,
    workspaceId: workspace.id,
    ownerId,
    author: actors[0]!,
    backup: actors[1]!,
    state,
    configure,
    close: async () => {
      for (const actor of actors) await actor.context.close();
    },
  };
}

test("comment mentions notify live, edits retain history and manager removal hides content", async ({
  page,
  browser,
}) => {
  const team = await approvalTeam(page, browser);
  try {
    const made = await postBoard(page, "create-task", {
      boardId: team.boardId,
      createKey: createRecordId(),
      name: "Mention conversation",
    });
    const taskId = (await made.json()).data.taskId;
    await team.backup.page.goto("/notifications");
    await team.author.page.goto(
      `/boards/${team.boardId}?task=${taskId}&tab=comments`,
    );
    await team.author.page
      .getByRole("textbox", { name: "New comment", exact: true })
      .fill("Please review this");
    await team.author.page
      .getByLabel("Mention teammate: New comment", { exact: true })
      .selectOption(team.backup.id);
    await team.author.page
      .getByRole("button", { name: "Post comment", exact: true })
      .click();
    await expect(
      team.backup.page.getByRole("link", {
        name: "Notifications (1 unread)",
        exact: true,
      }),
    ).toBeVisible();
    const comment = await getDatabase().taskComment.findFirstOrThrow({
      where: { taskId },
    });
    const row = team.author.page.locator(`[data-comment-id="${comment.id}"]`);
    await expect(row).toContainText("Please review this @Backup Reviewer");
    const notification = (await readInbox(team.backup.page)).items[0];
    expect(notification.kind).toBe("MENTION");
    const link = await changeInbox(team.backup.page, {
      action: "open",
      id: notification.id,
    });
    await team.backup.page.goto((await link.json()).data.href);
    await expect(team.backup.page.getByRole("dialog")).toBeVisible();
    await expect(
      team.backup.page.locator(".task-comments-panel"),
    ).toBeVisible();
    await expect(
      team.backup.page.getByRole("button", { name: "Edit", exact: true }),
    ).toHaveCount(0);
    await row.getByRole("button", { name: "Edit", exact: true }).click();
    await team.author.page
      .getByRole("textbox", { name: "Edit comment", exact: true })
      .fill("Updated review notes @Backup Reviewer");
    await team.author.page
      .getByRole("button", { name: "Save comment", exact: true })
      .click();
    await expect(row).toContainText("Updated review notes @Backup Reviewer");
    // Existing mentions do not generate duplicate notifications on every edit.
    expect(
      await getDatabase().notification.count({
        where: { kind: "MENTION", taskId },
      }),
    ).toBe(1);
    await row.getByRole("button", { name: "History", exact: true }).click();
    await expect(
      team.author.page.getByLabel("Comment edit history"),
    ).toContainText("Please review this @Backup Reviewer");
    await team.author.page.screenshot({
      path: "../../artifacts/comments/history-desktop.png",
      fullPage: true,
    });
    await team.author.page.setViewportSize({ width: 390, height: 844 });
    await team.author.page.screenshot({
      path: "../../artifacts/comments/history-mobile.png",
      fullPage: true,
    });
    await page.goto(`/boards/${team.boardId}?task=${taskId}&tab=comments`);
    const managed = page.locator(`[data-comment-id="${comment.id}"]`);
    await expect(
      managed.getByRole("button", { name: "Edit", exact: true }),
    ).toHaveCount(0);
    await managed.getByRole("button", { name: "Remove", exact: true }).click();
    await managed
      .getByRole("button", { name: "Remove comment", exact: true })
      .click();
    await expect(row).toContainText("Comment removed");
    await expect(row).not.toContainText("Updated review notes");
    expect(
      (
        await (
          await team.author.page.request.get(
            `/api/v1/boards/comment-history?commentId=${comment.id}`,
          )
        ).json()
      ).data,
    ).toEqual([]);
    expect(
      await getDatabase().commentRevision.count({
        where: { commentId: comment.id },
      }),
    ).toBe(3);
    expect((await readInbox(team.backup.page)).items).toHaveLength(0);
    expect((await team.state()).tasks[0].revision).toBe(1);
    expect((await team.state()).tasks[0].commentCount).toBe(0);
    expect(
      (await team.state()).tasks[0].activity.some(
        (event: { action: string }) => event.action === "Removed task comment",
      ),
    ).toBe(true);
  } finally {
    await team.close();
  }
});

test("comment changes enforce author rights, revision races, mention eligibility and legacy retries", async ({
  page,
  browser,
}) => {
  const team = await approvalTeam(page, browser);
  try {
    const db = getDatabase();
    const made = await postBoard(page, "create-task", {
      boardId: team.boardId,
      createKey: createRecordId(),
      name: "Protected comments",
    });
    const taskId = (await made.json()).data.taskId;
    const input = {
      taskId,
      createKey: createRecordId(),
      body: "Hello @Backup Reviewer",
      mentionIds: [team.backup.id],
    };
    const [one, two] = await Promise.all([
      postBoard(team.author.page, "comment", input),
      postBoard(team.author.page, "comment", input),
    ]);
    expect([one.status(), two.status()]).toEqual([200, 200]);
    const commentId = (await one.json()).data.id;
    expect(
      await db.notification.count({ where: { kind: "MENTION", taskId } }),
    ).toBe(1);
    expect(
      (
        await postBoard(team.author.page, "comment", {
          ...input,
          mentionIds: [team.ownerId],
        })
      ).status(),
    ).toBe(409);
    expect(
      (
        await postBoard(team.author.page, "comment", {
          ...input,
          createKey: createRecordId(),
          body: "No mention text",
        })
      ).status(),
    ).toBe(422);
    const outsider = await db.user.create({
      data: { name: "Outsider", email: "outsider@mention.test" },
    });
    expect(
      (
        await postBoard(team.author.page, "comment", {
          ...input,
          createKey: createRecordId(),
          body: "Hello @Outsider",
          mentionIds: [outsider.id],
        })
      ).status(),
    ).toBe(422);
    const edit = {
      action: "edit",
      commentId,
      revision: 1,
      body: "First change @Backup Reviewer",
      mentionIds: [team.backup.id],
    };
    expect((await postBoard(page, "change-comment", edit)).status()).toBe(403);
    expect(
      (
        await postBoard(team.backup.page, "change-comment", {
          action: "remove",
          commentId,
          revision: 1,
        })
      ).status(),
    ).toBe(403);
    const concurrent = await Promise.all([
      postBoard(team.author.page, "change-comment", edit),
      postBoard(team.author.page, "change-comment", {
        ...edit,
        body: "Second change @Backup Reviewer",
      }),
    ]);
    expect(concurrent.map((response) => response.status()).sort()).toEqual([
      200, 409,
    ]);
    expect(await db.commentRevision.count({ where: { commentId } })).toBe(2);
    expect(
      await db.notification.count({ where: { kind: "MENTION", taskId } }),
    ).toBe(1);
    expect((await postBoard(team.author.page, "comment", input)).status()).toBe(
      200,
    ); // Original creation retry survives edits.
    expect(
      (await postBoard(team.author.page, "change-comment", edit)).status(),
    ).toBe(409);
    const legacyKey = createRecordId();
    const legacy = await db.taskComment.create({
      data: {
        taskId,
        authorId: team.author.id,
        createKey: legacyKey,
        body: "Legacy text",
      },
    });
    expect(
      (
        await postBoard(team.author.page, "change-comment", {
          action: "edit",
          commentId: legacy.id,
          revision: 1,
          body: "Modern text",
        })
      ).status(),
    ).toBe(200);
    expect(
      (
        await postBoard(team.author.page, "comment", {
          taskId,
          createKey: legacyKey,
          body: "Legacy text",
        })
      ).status(),
    ).toBe(200);
    expect(
      (
        await (
          await team.author.page.request.get(
            `/api/v1/boards/comment-history?commentId=${legacy.id}`,
          )
        ).json()
      ).data.map((row: { body: string }) => row.body),
    ).toEqual(["Modern text", "Legacy text"]);
    await postBoard(page, "archive", { taskId, revision: 1 });
    expect(
      (
        await postBoard(team.author.page, "change-comment", {
          ...edit,
          revision: 2,
        })
      ).status(),
    ).toBe(409);
    expect(
      (
        await postBoard(page, "change-comment", {
          action: "remove",
          commentId,
          revision: 2,
        })
      ).status(),
    ).toBe(409);
    await postBoard(page, "restore", { taskId, revision: 2 });
    await db.installationSettings.update({
      where: { id: "installation" },
      data: { maintenanceMode: true },
    });
    expect(
      (
        await postBoard(team.author.page, "change-comment", {
          ...edit,
          revision: 2,
        })
      ).status(),
    ).toBe(503);
    await db.installationSettings.update({
      where: { id: "installation" },
      data: { maintenanceMode: false },
    });
    await db.workspaceMember.delete({
      where: {
        workspaceId_userId: {
          workspaceId: team.workspaceId,
          userId: team.author.id,
        },
      },
    });
    expect(
      (
        await postBoard(team.author.page, "change-comment", {
          ...edit,
          revision: 2,
        })
      ).status(),
    ).toBe(404);
    expect(
      (
        await team.author.page.request.get(
          `/api/v1/boards/comment-history?commentId=${commentId}`,
        )
      ).status(),
    ).toBe(404);
  } finally {
    await team.close();
  }
});

test("approval UI keeps pending moves off the board and routes owner requests to the backup", async ({
  page,
  browser,
}) => {
  test.setTimeout(90_000);
  const team = await approvalTeam(page, browser);
  const db = getDatabase();
  try {
    const made = await postBoard(page, "create-task", {
      boardId: team.boardId,
      createKey: crypto.randomUUID(),
      name: "Approval UI task",
      assigneeIds: [team.author.id],
    });
    const taskId = (await made.json()).data.taskId;
    await page.goto(`/boards/${team.boardId}`);
    await page
      .getByRole("button", { name: "Board details", exact: true })
      .click();
    await page
      .getByRole("switch", { name: "Approval mode", exact: true })
      .click();
    await page
      .getByLabel("Primary approver", { exact: true })
      .selectOption(team.ownerId);
    await page
      .getByLabel("Backup approver", { exact: true })
      .selectOption(team.backup.id);
    await page
      .getByLabel("Require approval for Status", { exact: true })
      .check();
    await page
      .getByRole("button", { name: "Save approval settings", exact: true })
      .click();
    await expect(
      page.locator('[data-slot="board-notification"]'),
    ).toContainText("Approval settings saved");
    await page
      .getByRole("button", { name: "Back to board", exact: true })
      .click();
    await team.author.page.goto(`/boards/${team.boardId}`);
    await page.goto("/approvals");
    await expect(page.locator('[data-slot="approval-queue"]')).toHaveAttribute(
      "data-connection",
      "live",
    );
    const lane = (name: string) =>
      team.author.page.locator(".board-lane").filter({
        has: team.author.page.getByRole("heading", { name, exact: true }),
      });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    await team.author.page.route("**/api/v1/boards/update", async (route) => {
      await gate;
      await route.continue();
    });
    await lane("To do").locator(".task-card").dragTo(lane("In progress"));
    await expect(lane("To do").locator(".task-card")).toHaveCount(1);
    await expect(lane("In progress").locator(".task-card")).toHaveCount(0);
    release();
    await expect(
      team.author.page.locator('[data-slot="board-notification"]'),
    ).toContainText("Changes sent for approval");
    await team.author.page.unroute("**/api/v1/boards/update");
    await expect(
      team.author.page.getByText("Awaiting approval", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", {
        name: "Review Approval UI task",
        exact: true,
      }),
    ).toBeVisible();
    expect(
      await db.task.findUniqueOrThrow({ where: { id: taskId } }),
    ).toMatchObject({ statusId: "todo", revision: 1 });
    await page.screenshot({
      path: "../../artifacts/approvals/queue-desktop.png",
      fullPage: true,
    });
    await page
      .getByRole("button", { name: "Review Approval UI task", exact: true })
      .click();
    await expect(page.getByLabel("Proposed changes")).toContainText("To do");
    await expect(page.getByLabel("Proposed changes")).toContainText(
      "In progress",
    );
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(
      page.getByRole("button", { name: "Approve request", exact: true }),
    ).toBeInViewport();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: "../../artifacts/approvals/review-mobile.png",
      fullPage: true,
    });
    await page
      .getByRole("button", { name: "Approve request", exact: true })
      .click();
    await expect(lane("In progress").locator(".task-card")).toHaveCount(1);
    await expect(
      team.author.page.getByText("Awaiting approval", { exact: true }),
    ).toHaveCount(0);
    const ownerRequest = await postBoard(page, "update", {
      taskId,
      revision: 2,
      requestKey: crypto.randomUUID(),
      changes: { statusId: "done" },
    });
    const ownerProposal = (await ownerRequest.json()).data;
    expect(ownerProposal.outcome).toBe("PENDING_APPROVAL");
    expect(
      (
        await postApproval(page, "decide", {
          proposalId: ownerProposal.proposalId,
          action: "approve",
        })
      ).status(),
    ).toBe(403);
    await expect(
      page.getByRole("button", {
        name: "Review Approval UI task",
        exact: true,
      }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Review Approval UI task", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Approve request", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Withdraw request", exact: true }),
    ).toBeVisible();
    const authorQueue = (
      await (
        await team.author.page.request.get("/api/v1/approvals/queue")
      ).json()
    ).data;
    expect(
      authorQueue.proposals.some(
        (item: { id: string }) => item.id === ownerProposal.proposalId,
      ),
    ).toBe(false);
    await team.backup.page.goto("/approvals");
    await team.backup.page
      .getByRole("button", { name: "Review Approval UI task", exact: true })
      .click();
    await team.backup.page
      .getByRole("button", { name: "Approve request", exact: true })
      .click();
    await expect(lane("Done").locator(".task-card")).toHaveCount(1);
    expect(
      (await db.task.findUniqueOrThrow({ where: { id: taskId } })).revision,
    ).toBe(3);
    await page.getByLabel("Filter approval requests").selectOption("APPROVED");
    await expect(page.locator('[data-slot="approval-queue"] li')).toHaveCount(
      2,
    );
  } finally {
    await team.close();
  }
});

test("approval transactions enforce field conflicts, current authority, rejection, withdrawal and policy changes", async ({
  page,
  browser,
}) => {
  test.setTimeout(90_000);
  const team = await approvalTeam(page, browser);
  const db = getDatabase();
  try {
    const initial = await team.state();
    const assigneeField = initial.fields.find(
      (field: { key: string }) => field.key === "assignees",
    ).id;
    const statusField = initial.fields.find(
      (field: { key: string }) => field.key === "status",
    ).id;
    expect(
      (
        await postApproval(team.author.page, "configure", {
          ...initial.approvalPolicy,
          boardId: team.boardId,
          enabled: true,
          primaryApproverId: team.ownerId,
        })
      ).status(),
    ).toBe(403);
    expect(
      (
        await team.configure({
          primaryApproverId: team.ownerId,
          backupApproverId: team.ownerId,
        })
      ).status(),
    ).toBe(422);
    expect(
      (
        await team.configure({
          backupApproverId: null,
          protectedFieldIds: [assigneeField, statusField],
        })
      ).status(),
    ).toBe(200);
    const created = await postBoard(page, "create-task", {
      boardId: team.boardId,
      createKey: crypto.randomUUID(),
      name: "Protected task",
      description: "Original",
      assigneeIds: [team.author.id],
    });
    const taskId = (await created.json()).data.taskId;
    expect(
      (
        await postBoard(page, "update", {
          taskId,
          revision: 1,
          changes: { statusId: "done" },
        })
      ).status(),
    ).toBe(409);
    expect(await db.boardProposal.count()).toBe(0);
    expect(
      (
        await team.configure({
          protectedFieldIds: [assigneeField, statusField],
        })
      ).status(),
    ).toBe(200);
    const input = {
      taskId,
      revision: 1,
      requestKey: crypto.randomUUID(),
      changes: {
        statusId: "in_progress",
        description: "Whole proposed change",
      },
    };
    const responses = await Promise.all([
      postBoard(team.author.page, "update", input),
      postBoard(team.author.page, "update", input),
    ]);
    for (const response of responses) expect(response.status()).toBe(200);
    const proposalId = (await responses[0]!.json()).data.proposalId;
    expect((await responses[1]!.json()).data.proposalId).toBe(proposalId);
    expect(await db.boardProposal.count()).toBe(1);
    expect(
      await db.task.findUniqueOrThrow({ where: { id: taskId } }),
    ).toMatchObject({ statusId: "todo", description: "Original", revision: 1 });
    expect(
      (
        await postApproval(team.author.page, "decide", {
          proposalId,
          action: "approve",
        })
      ).status(),
    ).toBe(403);
    expect(
      (
        await postApproval(team.backup.page, "decide", {
          proposalId,
          action: "approve",
        })
      ).status(),
    ).toBe(403);
    expect(
      (
        await postBoard(team.backup.page, "update", {
          taskId,
          revision: 1,
          changes: { description: "No editor rights" },
        })
      ).status(),
    ).toBe(403);
    // An unrelated direct edit does not invalidate the proposal or get overwritten.
    expect(
      (
        await postBoard(page, "update", {
          taskId,
          revision: 1,
          changes: { priority: "HIGH" },
        })
      ).status(),
    ).toBe(200);
    const decisions = await Promise.all([
      postApproval(page, "decide", { proposalId, action: "approve" }),
      postApproval(page, "decide", { proposalId, action: "approve" }),
    ]);
    expect(decisions.map((response) => response.status()).sort()).toEqual([
      200, 409,
    ]);
    expect(
      await db.task.findUniqueOrThrow({ where: { id: taskId } }),
    ).toMatchObject({
      statusId: "in_progress",
      description: "Whole proposed change",
      priority: "HIGH",
      revision: 3,
    });
    expect(await db.taskActivity.count({ where: { taskId } })).toBe(3);
    const request = async (changes: unknown) => {
      const current = await db.task.findUniqueOrThrow({
        where: { id: taskId },
      });
      const response = await postBoard(team.author.page, "update", {
        taskId,
        revision: current.revision,
        requestKey: crypto.randomUUID(),
        changes,
      });
      expect(response.status()).toBe(200);
      return (await response.json()).data;
    };
    const stale = await request({ statusId: "done" });
    // A separately approved conflicting edit makes the first request stale.
    const own = await postBoard(page, "update", {
      taskId,
      revision: 3,
      requestKey: crypto.randomUUID(),
      changes: { statusId: "todo" },
    });
    const ownId = (await own.json()).data.proposalId;
    expect(
      (
        await postApproval(team.backup.page, "decide", {
          proposalId: ownId,
          action: "approve",
        })
      ).status(),
    ).toBe(200);
    const staleDecision = (
      await (
        await postApproval(page, "decide", {
          proposalId: stale.proposalId,
          action: "approve",
        })
      ).json()
    ).data;
    expect(staleDecision.status).toBe("STALE");
    expect(
      (await db.task.findUniqueOrThrow({ where: { id: taskId } })).statusId,
    ).toBe("todo");
    const rejected = await request({ statusId: "done" });
    expect(
      (
        await postApproval(page, "decide", {
          proposalId: rejected.proposalId,
          action: "reject",
          reason: " ",
        })
      ).status(),
    ).toBe(422);
    expect(
      (
        await postApproval(page, "decide", {
          proposalId: rejected.proposalId,
          action: "reject",
          reason: "Finish the checks first.",
        })
      ).status(),
    ).toBe(200);
    expect(
      (
        await db.boardProposal.findUniqueOrThrow({
          where: { id: rejected.proposalId },
        })
      ).reason,
    ).toBe("Finish the checks first.");
    const withdrawn = await request({ statusId: "done" });
    expect(
      (
        await postApproval(page, "decide", {
          proposalId: withdrawn.proposalId,
          action: "withdraw",
        })
      ).status(),
    ).toBe(403);
    expect(
      (
        await postApproval(team.author.page, "decide", {
          proposalId: withdrawn.proposalId,
          action: "withdraw",
        })
      ).status(),
    ).toBe(200);
    const invalidated = await request({ statusId: "done" });
    expect((await team.configure({ enabled: false })).status()).toBe(200);
    expect(
      (
        await db.boardProposal.findUniqueOrThrow({
          where: { id: invalidated.proposalId },
        })
      ).status,
    ).toBe("STALE");
    expect(
      (await db.task.findUniqueOrThrow({ where: { id: taskId } })).statusId,
    ).toBe("todo");
    expect(
      (
        await team.configure({
          protectedFieldIds: [assigneeField, statusField],
          requireArchive: true,
        })
      ).status(),
    ).toBe(200);
    const archived = await postBoard(team.author.page, "archive", {
      taskId,
      revision: 4,
      requestKey: crypto.randomUUID(),
    });
    const archiveId = (await archived.json()).data.proposalId;
    expect(
      (await db.task.findUniqueOrThrow({ where: { id: taskId } })).archivedAt,
    ).toBeNull();
    expect(
      (
        await postApproval(page, "decide", {
          proposalId: archiveId,
          action: "approve",
        })
      ).status(),
    ).toBe(200);
    expect(
      (await db.task.findUniqueOrThrow({ where: { id: taskId } })).archivedAt,
    ).not.toBeNull();
    expect(
      (await postBoard(page, "restore", { taskId, revision: 5 })).status(),
    ).toBe(200);
    const revoked = await request({ statusId: "done" });
    // Assignee rights are revoked by another approved assignment change.
    const remove = await postBoard(page, "update", {
      taskId,
      revision: 6,
      requestKey: crypto.randomUUID(),
      changes: { assigneeIds: [] },
    });
    expect(
      (
        await postApproval(team.backup.page, "decide", {
          proposalId: (await remove.json()).data.proposalId,
          action: "approve",
        })
      ).status(),
    ).toBe(200);
    expect(
      (
        await (
          await postApproval(page, "decide", {
            proposalId: revoked.proposalId,
            action: "approve",
          })
        ).json()
      ).data.status,
    ).toBe("STALE");
    // Approver changes are compatible with the request, but immediately revoke the old reviewer.
    expect(
      (
        await postBoard(page, "editor", {
          taskId,
          revision: 7,
          userId: team.author.id,
          grant: true,
        })
      ).status(),
    ).toBe(200);
    const rerouted = await request({ statusId: "done" });
    expect(
      (
        await team.configure({
          primaryApproverId: team.backup.id,
          backupApproverId: team.ownerId,
          protectedFieldIds: [assigneeField, statusField],
        })
      ).status(),
    ).toBe(200);
    expect(
      (
        await postApproval(page, "decide", {
          proposalId: rerouted.proposalId,
          action: "approve",
        })
      ).status(),
    ).toBe(403);
    expect(
      (
        await postApproval(team.backup.page, "decide", {
          proposalId: rerouted.proposalId,
          action: "approve",
        })
      ).status(),
    ).toBe(200);
  } finally {
    await team.close();
  }
});

test("creation approvals hide drafts, deduplicate retries and revalidate people, membership and maintenance", async ({
  page,
  browser,
}) => {
  test.setTimeout(90_000);
  const team = await approvalTeam(page, browser);
  const db = getDatabase();
  try {
    expect((await team.configure({ requireCreation: true })).status()).toBe(
      200,
    );
    const body = {
      boardId: team.boardId,
      createKey: crypto.randomUUID(),
      name: "Pending new task",
      assigneeIds: [team.backup.id],
    };
    const attempts = await Promise.all([
      postBoard(team.author.page, "create-task", body),
      postBoard(team.author.page, "create-task", body),
    ]);
    for (const attempt of attempts) expect(attempt.status()).toBe(200);
    const proposalId = (await attempts[0]!.json()).data.proposalId;
    expect((await attempts[1]!.json()).data.proposalId).toBe(proposalId);
    expect(await db.task.count({ where: { boardId: team.boardId } })).toBe(0);
    expect((await team.state()).tasks).toHaveLength(0);
    expect(
      (
        await postBoard(team.author.page, "create-task", {
          ...body,
          name: "Changed retry",
        })
      ).status(),
    ).toBe(409);
    await db.installationSettings.update({
      where: { id: "installation" },
      data: { maintenanceMode: true },
    });
    expect(
      (
        await postApproval(page, "decide", { proposalId, action: "approve" })
      ).status(),
    ).toBe(503);
    await db.installationSettings.update({
      where: { id: "installation" },
      data: { maintenanceMode: false },
    });
    const decisions = await Promise.all([
      postApproval(page, "decide", { proposalId, action: "approve" }),
      postApproval(page, "decide", { proposalId, action: "approve" }),
    ]);
    expect(decisions.map((response) => response.status()).sort()).toEqual([
      200, 409,
    ]);
    const task = await db.task.findFirstOrThrow({
      where: { boardId: team.boardId },
    });
    expect(task.createdById).toBe(team.author.id);
    expect(
      await db.taskAssignee.count({
        where: { taskId: task.id, userId: team.backup.id },
      }),
    ).toBe(1);
    expect(
      (await postBoard(team.author.page, "create-task", body)).status(),
    ).toBe(200);
    expect(await db.task.count({ where: { boardId: team.boardId } })).toBe(1);
    const peopleDraft = await postBoard(team.author.page, "create-task", {
      ...body,
      createKey: crypto.randomUUID(),
      name: "Invalid people later",
    });
    const peopleProposal = (await peopleDraft.json()).data.proposalId;
    await db.workspaceMember.delete({
      where: {
        workspaceId_userId: {
          workspaceId: team.workspaceId,
          userId: team.backup.id,
        },
      },
    });
    expect(
      (
        await (
          await postApproval(page, "decide", {
            proposalId: peopleProposal,
            action: "approve",
          })
        ).json()
      ).data.status,
    ).toBe("STALE");
    const scopedDraft = await postBoard(team.author.page, "create-task", {
      boardId: team.boardId,
      createKey: crypto.randomUUID(),
      name: "Author removed later",
    });
    const scopedId = (await scopedDraft.json()).data.proposalId;
    await db.workspaceMember.delete({
      where: {
        workspaceId_userId: {
          workspaceId: team.workspaceId,
          userId: team.author.id,
        },
      },
    });
    expect(
      (
        await (
          await postApproval(page, "decide", {
            proposalId: scopedId,
            action: "approve",
          })
        ).json()
      ).data.status,
    ).toBe("STALE");
    expect(
      (
        await (
          await team.author.page.request.get(
            "/api/v1/approvals/queue?status=ALL",
          )
        ).json()
      ).data.proposals,
    ).toHaveLength(0);
    expect(await db.task.count({ where: { boardId: team.boardId } })).toBe(1);
  } finally {
    await team.close();
  }
});

test("notification inbox delivers assignments live, persists read state and opens the task sheet", async ({
  page,
  browser,
}) => {
  const team = await approvalTeam(page, browser);
  const mirrorContext = await browser.newContext({
    storageState: await team.author.context.storageState(),
  });
  try {
    await team.author.page.goto("/notifications");
    await expect(team.author.page.getByText("Nothing here yet")).toBeVisible();
    const input = {
      boardId: team.boardId,
      createKey: createRecordId(),
      name: "Ship notification inbox",
      assigneeIds: [team.author.id],
    };
    const made = await postBoard(page, "create-task", input);
    expect(made.status()).toBe(200);
    const taskId = (await made.json()).data.taskId;
    // Same intent retry must not create another inbox record.
    expect((await postBoard(page, "create-task", input)).status()).toBe(200);
    await expect(
      team.author.page.getByRole("link", {
        name: "Notifications (1 unread)",
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      team.author.page.getByText("Ship notification inbox", { exact: true }),
    ).toBeVisible();
    const id = (await readInbox(team.author.page)).items[0].id;
    const mirror = await mirrorContext.newPage();
    await mirror.goto("/notifications");
    await expect(
      mirror.getByRole("link", {
        name: "Notifications (1 unread)",
        exact: true,
      }),
    ).toBeVisible();
    await team.author.page.evaluate(() => document.fonts.ready);
    await team.author.page.screenshot({
      path: "../../artifacts/notifications/inbox-desktop.png",
      fullPage: true,
    });
    await team.author.page.setViewportSize({ width: 390, height: 844 });
    await team.author.page.screenshot({
      path: "../../artifacts/notifications/inbox-mobile.png",
      fullPage: true,
    });
    await team.author.page
      .getByRole("switch", { name: "Dark mode", exact: true })
      .click();
    await expect(
      team.author.page.getByRole("switch", { name: "Dark mode", exact: true }),
    ).toBeEnabled();
    await team.author.page.screenshot({
      path: "../../artifacts/notifications/inbox-dark-mobile.png",
      fullPage: true,
    });
    await team.author.page
      .getByRole("button", {
        name: "Mark as read: Ship notification inbox",
        exact: true,
      })
      .click();
    await expect
      .poll(async () => (await readInbox(team.author.page)).unreadCount)
      .toBe(0);
    await expect(
      mirror.getByRole("link", { name: "Notifications", exact: true }),
    ).toBeVisible();
    await expect(
      team.author.page.getByRole("button", {
        name: "Mark as unread: Ship notification inbox",
        exact: true,
      }),
    ).toBeVisible();
    await team.author.page
      .getByRole("button", {
        name: "Mark as unread: Ship notification inbox",
        exact: true,
      })
      .click();
    await expect
      .poll(async () => (await readInbox(team.author.page)).unreadCount)
      .toBe(1);
    await team.author.page
      .locator(`[data-notification-id="${id}"]`)
      .getByRole("button")
      .first()
      .click();
    await expect(team.author.page).toHaveURL(
      new RegExp(`/boards/${team.boardId}\\?task=${taskId}`),
    );
    await expect(team.author.page.getByRole("dialog")).toBeVisible();
    await expect
      .poll(async () => (await readInbox(team.author.page)).unreadCount)
      .toBe(0);
    await team.author.page.reload();
    await expect(team.author.page.getByRole("dialog")).toBeVisible();
    expect((await readInbox(team.author.page)).items).toHaveLength(1);
    expect((await changeInbox(page, { action: "open", id })).status()).toBe(
      404,
    );
    expect(
      (
        await changeInbox(team.backup.page, { action: "read", id, read: true })
      ).status(),
    ).toBe(404);
    expect(
      (
        await changeInbox(
          team.author.page,
          { action: "read", id, read: false },
          "https://other.test",
        )
      ).status(),
    ).toBe(403);
    await getDatabase().workspaceMember.delete({
      where: {
        workspaceId_userId: {
          workspaceId: team.workspaceId,
          userId: team.author.id,
        },
      },
    });
    expect((await readInbox(team.author.page)).items).toHaveLength(0);
    expect((await readInbox(team.author.page)).unreadCount).toBe(0);
    expect(
      (await changeInbox(team.author.page, { action: "open", id })).status(),
    ).toBe(404);
  } finally {
    await mirrorContext.close();
    await team.close();
  }
});

test("approval notifications wait for acceptance and follow reviewer reassignment without leaking old requests", async ({
  page,
  browser,
}) => {
  const team = await approvalTeam(page, browser);
  try {
    const current = await team.state();
    const assigneeField = current.fields.find(
      (field: { key: string }) => field.key === "assignees",
    ).id;
    const made = await postBoard(team.author.page, "create-task", {
      boardId: team.boardId,
      createKey: createRecordId(),
      name: "Approval notification task",
    });
    expect(made.status(), JSON.stringify(await made.json())).toBe(200);
    const taskId = (await made.json()).data.taskId;
    expect(
      (
        await team.configure({
          protectedFieldIds: [assigneeField],
          primaryApproverId: team.backup.id,
          backupApproverId: null,
        })
      ).status(),
    ).toBe(200);
    const requestKey = createRecordId();
    const body = {
      taskId,
      revision: 1,
      requestKey,
      changes: { assigneeIds: [team.ownerId] },
    };
    const submitted = await postBoard(team.author.page, "update", body);
    expect(submitted.status(), JSON.stringify(await submitted.json())).toBe(
      200,
    );
    const proposalId = (await submitted.json()).data.proposalId;
    expect((await postBoard(team.author.page, "update", body)).status()).toBe(
      200,
    );
    let inbox = await readInbox(team.backup.page);
    expect(inbox.items).toHaveLength(1);
    expect(inbox.items[0].kind).toBe("APPROVAL_REQUEST");
    expect((await readInbox(page)).items).toHaveLength(0); // Proposed assignment is not active.
    const link = await changeInbox(team.backup.page, {
      action: "open",
      id: inbox.items[0].id,
    });
    await team.backup.page.goto((await link.json()).data.href);
    await expect(team.backup.page.getByRole("dialog")).toBeVisible();
    await expect(
      team.backup.page.getByRole("button", {
        name: "Approve request",
        exact: true,
      }),
    ).toBeVisible();
    expect(
      (
        await team.configure({
          primaryApproverId: team.ownerId,
          backupApproverId: null,
        })
      ).status(),
    ).toBe(200);
    expect((await readInbox(team.backup.page)).items).toHaveLength(0);
    expect(
      (
        await changeInbox(team.backup.page, {
          action: "open",
          id: inbox.items[0].id,
        })
      ).status(),
    ).toBe(404);
    expect(
      (
        await postApproval(team.backup.page, "decide", {
          proposalId,
          action: "approve",
        })
      ).status(),
    ).toBe(403);
    // Approve as owner; self-assignment by the applying actor is deliberately quiet.
    expect(
      (
        await postApproval(page, "decide", { proposalId, action: "approve" })
      ).status(),
    ).toBe(200);
    inbox = await readInbox(team.author.page);
    expect(inbox.items).toHaveLength(1);
    expect(inbox.items[0].kind).toBe("APPROVAL_DECISION");
    expect(inbox.items[0].message).toBe("approved your request");
    expect(
      (
        await postApproval(page, "decide", { proposalId, action: "approve" })
      ).status(),
    ).toBe(409);
    expect((await readInbox(team.author.page)).items).toHaveLength(1);
    const revision = (await team.state()).tasks[0].revision;
    const request = await postBoard(team.author.page, "update", {
      taskId,
      revision,
      requestKey: createRecordId(),
      changes: { assigneeIds: [team.backup.id] },
    });
    const next = (await request.json()).data.proposalId;
    expect((await readInbox(team.backup.page)).items).toHaveLength(0);
    expect(
      (
        await postApproval(page, "decide", {
          proposalId: next,
          action: "approve",
        })
      ).status(),
    ).toBe(200);
    expect((await readInbox(team.backup.page)).items[0].kind).toBe(
      "ASSIGNMENT",
    );
    const rejection = await postBoard(team.author.page, "update", {
      taskId,
      revision: revision + 1,
      requestKey: createRecordId(),
      changes: { assigneeIds: [] },
    });
    expect(
      (
        await postApproval(page, "decide", {
          proposalId: (await rejection.json()).data.proposalId,
          action: "reject",
          reason: "Keep the reviewer assigned",
        })
      ).status(),
    ).toBe(200);
    expect((await readInbox(team.author.page)).items[0].message).toBe(
      "rejected your request",
    );
  } finally {
    await team.close();
  }
});

test("inbox pagination and concurrent read controls preserve new arrivals and enforce recipient scope", async ({
  page,
  browser,
}) => {
  const team = await approvalTeam(page, browser);
  try {
    const db = getDatabase();
    const made = await postBoard(page, "create-task", {
      boardId: team.boardId,
      createKey: createRecordId(),
      name: "Inbox pagination task",
    });
    const taskId = (await made.json()).data.taskId;
    await db.notification.createMany({
      data: Array.from({ length: 33 }, (_, i) => ({
        id: createRecordId(),
        recipientId: team.author.id,
        actorId: team.ownerId,
        boardId: team.boardId,
        taskId,
        kind: "ASSIGNMENT",
        message: "assigned you to this task",
        eventKey: `test-event:${i}`,
      })),
    });
    const first = await readInbox(team.author.page);
    expect(first.items).toHaveLength(30);
    expect(first.unreadCount).toBe(33);
    const second = await readInbox(
      team.author.page,
      `?cursor=${first.nextCursor}`,
    );
    expect(second.items).toHaveLength(3);
    expect(second.nextCursor).toBeNull();
    expect(
      new Set([...first.items, ...second.items].map((item) => item.id)).size,
    ).toBe(33);
    const arriving = await db.notification.create({
      data: {
        recipientId: team.author.id,
        actorId: team.ownerId,
        boardId: team.boardId,
        taskId,
        kind: "ASSIGNMENT",
        message: "assigned you to this task",
        eventKey: "new-arrival",
      },
    });
    expect(
      (
        await changeInbox(team.author.page, {
          action: "read-all",
          throughId: first.items[0].id,
        })
      ).status(),
    ).toBe(200);
    expect(
      (await readInbox(team.author.page, "?filter=UNREAD")).items.map(
        (item: { id: string }) => item.id,
      ),
    ).toEqual([arriving.id]);
    const results = await Promise.all([
      changeInbox(team.author.page, {
        action: "read",
        id: arriving.id,
        read: true,
      }),
      changeInbox(team.author.page, {
        action: "read",
        id: arriving.id,
        read: true,
      }),
    ]);
    expect(results.map((result) => result.status())).toEqual([200, 200]);
    expect((await readInbox(team.author.page)).unreadCount).toBe(0);
    expect(
      (
        await changeInbox(team.backup.page, {
          action: "read-all",
          throughId: arriving.id,
        })
      ).status(),
    ).toBe(404);
    expect(
      (
        await team.author.page.request.get(
          "/api/v1/notifications/inbox?cursor=invalid",
        )
      ).status(),
    ).toBe(422);
    const anonymous = await browser.newContext();
    try {
      expect(
        (
          await anonymous.request.get(
            "http://127.0.0.1:3100/api/v1/notifications/inbox",
          )
        ).status(),
      ).toBe(401);
    } finally {
      await anonymous.close();
    }
    await db.installationSettings.update({
      where: { id: "installation" },
      data: { maintenanceMode: true },
    });
    // Read controls are personal preferences, not task changes, and remain usable.
    expect(
      (
        await changeInbox(team.author.page, {
          action: "read",
          id: arriving.id,
          read: false,
        })
      ).status(),
    ).toBe(200);
  } finally {
    await team.close();
  }
});
