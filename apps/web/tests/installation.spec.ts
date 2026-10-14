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
  await page.getByLabel("Color mode", { exact: true }).selectOption("dark");
  await expect(page.locator("html")).toHaveAttribute("data-mode", "dark");
  expect(await rootPrimary()).toBe(presets[1].dark.primary);
  await page.reload();
  await expect(page.getByLabel("Color mode", { exact: true })).toHaveValue(
    "dark",
  );
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
  await visitor.getByLabel("Color mode").selectOption("system");
  await visitor.emulateMedia({ colorScheme: "dark" });
  await expect(visitor.locator("html")).toHaveAttribute("data-mode", "dark");
  await visitor.emulateMedia({ colorScheme: "light" });
  await expect(visitor.locator("html")).toHaveAttribute("data-mode", "light");
  await visitor.getByLabel("Color mode").selectOption("dark");
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
  await expect(page.getByLabel("Color mode")).toHaveValue("dark");
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
