import { test, expect, type Page } from "@playwright/test";
import { createRecordId, getDatabase } from "@yuzu/database";

process.env.DATABASE_URL = process.env.YUZU_E2E_DATABASE_URL;
const ORIGIN = "http://127.0.0.1:3100";
const MIA_PASSWORD = "mia-member-password-123";

test.beforeEach(async () => {
  if (new URL(process.env.DATABASE_URL!).pathname !== "/yuzu_e2e")
    throw new Error("Refusing to reset a non-test database.");
  const db = getDatabase();
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

/** An owner (signed in on `page`), a member with a password, and a board. */
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
    },
  });
  const memberId = createRecordId();
  const member = await db.user.create({
    data: {
      id: memberId,
      name: "Mia Member",
      email: "mia@example.test",
      emailVerified: true,
      accounts: {
        create: {
          accountId: memberId,
          providerId: "credential",
          password: await (
            await import("better-auth/crypto")
          ).hashPassword(MIA_PASSWORD),
        },
      },
    },
  });
  await db.workspaceMember.create({
    data: { workspaceId: workspace.id, userId: member.id },
  });
  return { owner, member, workspace, board: seed };
}

const signIn = (page: Page, email: string, password: string) =>
  post(page, "/api/v1/session/sign-in", { email, password });

test("owners change roles, deactivate and reactivate people, with an audit trail", async ({
  page,
  browser,
}) => {
  test.setTimeout(90_000);
  const { owner, member, board } = await team(page);
  const db = getDatabase();
  const role = async () =>
    (await db.user.findUniqueOrThrow({ where: { id: member.id } })).role;

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/settings/team");
  const rows = page.locator(".people-admin-rows > li");
  await expect(rows).toHaveCount(2);
  // The owner's own row has no menu.
  await expect(
    page.getByRole("button", { name: "Manage Team Owner" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Manage Mia Member" }).click();
  await page.getByRole("menuitem", { name: /Make admin/ }).click();
  await expect.poll(role).toBe("ADMIN");
  await expect(rows.filter({ hasText: "Mia Member" })).toContainText("Admin");

  // As an admin, Mia saves a rule that runs as her.
  const mia = await browser.newContext();
  const miaPage = await mia.newPage();
  expect((await signIn(miaPage, member.email, MIA_PASSWORD)).status()).toBe(
    200,
  );
  expect(
    (
      await post(miaPage, "/api/v1/automations/save", {
        boardId: board.id,
        name: "Mia's rule",
        trigger: { kind: "task.created" },
        actions: [{ kind: "set.priority", value: "HIGH" }],
      })
    ).status(),
  ).toBe(200);
  // An admin can't change roles; only the owner can.
  expect(
    (
      await post(miaPage, "/api/v1/admin/role", {
        userId: owner.id,
        role: "MEMBER",
      })
    ).status(),
  ).toBe(403);

  await page.getByRole("button", { name: "Manage Mia Member" }).click();
  await page.getByRole("menuitem", { name: /Make member/ }).click();
  await expect.poll(role).toBe("MEMBER");

  // Deactivating signs Mia out and pauses her rule.
  await page.getByRole("button", { name: "Manage Mia Member" }).click();
  await page.getByRole("menuitem", { name: /Deactivate/ }).click();
  const dialog = page.getByRole("alertdialog").or(page.getByRole("dialog"));
  await expect(dialog).toContainText("1 rule they made pause");
  await page.screenshot({ path: "../../artifacts/admin/deactivate.png" });
  await dialog.getByRole("button", { name: "Deactivate Mia" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(rows.filter({ hasText: "Mia Member" })).toHaveCount(0);
  await page.getByRole("button", { name: /^Deactivated 1/ }).click();
  await expect(rows.filter({ hasText: "Mia Member" })).toContainText(
    "deactivated by Team Owner",
  );
  expect(await db.session.count({ where: { userId: member.id } })).toBe(0);
  const rule = await db.automationRule.findFirstOrThrow({
    where: { createdById: member.id },
  });
  expect(rule.enabled).toBe(false);
  expect(rule.pausedReason).toContain("Mia Member was deactivated");
  expect((await miaPage.request.get("/api/v1/email/settings")).status()).toBe(
    401,
  );
  const refused = await signIn(miaPage, member.email, MIA_PASSWORD);
  expect(refused.status()).toBe(403);
  expect((await refused.json()).error.message).toContain("deactivated");
  // A wrong password still reads as a wrong password.
  expect(
    (await signIn(miaPage, member.email, "not-the-password-123")).status(),
  ).toBe(401);
  // Pickers leave her out, but her name stays known to the board.
  const state = await (
    await page.request.get(`/api/v1/boards/state?boardId=${board.id}`)
  ).json();
  expect(
    state.data.people.find((person: { id: string }) => person.id === member.id),
  ).toMatchObject({ deactivated: true });

  await page.getByRole("button", { name: "Manage Mia Member" }).click();
  await page.getByRole("menuitem", { name: /Reactivate/ }).click();
  await expect(rows.filter({ hasText: "Mia Member" })).toHaveCount(0);
  expect((await signIn(miaPage, member.email, MIA_PASSWORD)).status()).toBe(
    200,
  );
  await mia.close();

  await page.goto("/settings/audit");
  const log = page.locator(".audit-events");
  await expect(log).toContainText("Team Owner reactivated Mia Member");
  await expect(log).toContainText("Team Owner deactivated Mia Member");
  await expect(log).toContainText("Paused 1 rule");
  await expect(log).toContainText("Team Owner made Mia Member an admin");
  await page.getByLabel("Filter by event").selectOption("people");
  await expect(page.locator(".audit-events li")).toHaveCount(4);
  await page.screenshot({ path: "../../artifacts/admin/audit.png" });
});

test("workspaces archive and restore, and ownership transfers with a password", async ({
  page,
  browser,
}) => {
  test.setTimeout(90_000);
  const { owner, member } = await team(page);
  const db = getDatabase();
  const other = await db.workspace.create({
    data: {
      name: "Old marketing",
      createdById: owner.id,
      members: { create: [{ userId: owner.id }, { userId: member.id }] },
    },
  });
  const archivedBoard = await db.board.create({
    data: { name: "Campaigns", workspaceId: other.id, createdById: owner.id },
  });
  const mia = await browser.newContext();
  const miaPage = await mia.newPage();
  expect((await signIn(miaPage, member.email, MIA_PASSWORD)).status()).toBe(
    200,
  );
  const miaSees = async () =>
    (
      await miaPage.request.get(
        `/api/v1/boards/state?boardId=${archivedBoard.id}`,
      )
    ).status();
  expect(await miaSees()).toBe(200);

  await page.goto("/settings/workspaces");
  const row = page
    .locator(".workspace-admin-rows > li")
    .filter({ hasText: "Old marketing" });
  await row.getByRole("button", { name: "Rename" }).click();
  await page.getByLabel("Workspace name").fill("Marketing archive");
  await page.getByRole("button", { name: "Save" }).click();
  const renamed = page
    .locator(".workspace-admin-rows > li")
    .filter({ hasText: "Marketing archive" });
  await expect(renamed).toBeVisible();
  await renamed.getByRole("button", { name: "Archive" }).click();
  await page.getByRole("button", { name: "Archive workspace" }).click();
  await expect(renamed).toContainText("Archived");
  await page.screenshot({ path: "../../artifacts/admin/workspaces.png" });
  expect(await miaSees()).toBe(404);
  // The last open workspace can't be archived.
  const last = await post(page, "/api/v1/admin/archive-workspace", {
    workspaceId: (
      await db.workspace.findFirstOrThrow({
        where: { archivedAt: null },
      })
    ).id,
  });
  expect(last.status()).toBe(409);
  await renamed.getByRole("button", { name: "Restore" }).click();
  await expect(renamed).not.toContainText("Archived");
  expect(await miaSees()).toBe(200);

  // Ownership goes to an admin, after the owner's password.
  await post(page, "/api/v1/admin/role", { userId: member.id, role: "ADMIN" });
  await page.goto("/settings/team");
  await page.getByRole("button", { name: "Manage Mia Member" }).click();
  await page.getByRole("menuitem", { name: /Transfer ownership/ }).click();
  const modal = page.getByRole("dialog");
  await modal.getByLabel("Your password").fill("wrong-password-123");
  await modal.getByRole("button", { name: "Transfer ownership" }).click();
  await expect(
    page.getByText("That password isn't right. Try again.", { exact: true }),
  ).toBeVisible();
  await modal.getByLabel("Your password").fill("test-owner-password-123");
  await modal.getByRole("button", { name: "Transfer ownership" }).click();
  await expect
    .poll(
      async () =>
        (await db.user.findUniqueOrThrow({ where: { id: member.id } })).role,
    )
    .toBe("OWNER");
  expect(
    (await db.user.findUniqueOrThrow({ where: { id: owner.id } })).role,
  ).toBe("ADMIN");
  expect(
    (
      await db.installationSettings.findUniqueOrThrow({
        where: { id: "installation" },
      })
    ).ownerId,
  ).toBe(member.id);
  // The former owner, now an admin, can't touch the new owner.
  expect(
    (
      await post(page, "/api/v1/admin/deactivate", { userId: member.id })
    ).status(),
  ).toBe(403);
  await mia.close();
});
