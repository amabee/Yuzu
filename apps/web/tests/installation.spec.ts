import { test as base, expect } from "@playwright/test";
import { SMTPServer } from "smtp-server";
import { getDatabase } from "@yuzu/database";

process.env.DATABASE_URL = process.env.YUZU_E2E_DATABASE_URL;
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
  await db.user.create({
    data: {
      id: "interrupted-user",
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
  ).not.toBe("interrupted-user");
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
