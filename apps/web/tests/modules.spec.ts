import { test, expect, type Page } from "@playwright/test";
import { getDatabase } from "@yuzu/database";
process.env.DATABASE_URL = process.env.YUZU_E2E_DATABASE_URL;
const ORIGIN = "http://127.0.0.1:3100";
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
const ok = async (response: Awaited<ReturnType<typeof post>>) => {
  expect(response.status(), await response.text()).toBe(200);
  return (await response.json()).data;
};

async function setup(page: Page) {
  await ok(
    await post(page, "/api/v1/setup/owner", {
      name: "Team Owner",
      email: "owner@example.test",
      password: "test-owner-password-123",
      confirmPassword: "test-owner-password-123",
      setupKey: process.env.YUZU_E2E_SETUP_KEY,
    }),
  );
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
  const board = (
    await ok(
      await post(page, "/api/v1/boards/create-board", {
        workspaceId: workspace.id,
        name: "Launch",
      }),
    )
  ).id as string;
  return { owner, workspace, board };
}

test("Work and CRM have separate navigation with shared access and responsive controls", async ({
  page,
  browser,
}) => {
  test.setTimeout(process.env.YUZU_E2E_DEV === "1" ? 120_000 : 45_000);
  const navigationTimeout = process.env.YUZU_E2E_DEV === "1" ? 30_000 : 10_000;
  const { board } = await setup(page);
  await page.goto(`/boards/${board}`);
  const modules = page.getByRole("navigation", {
    name: "Modules",
    exact: true,
  });
  await expect(
    modules.getByRole("link", { name: "Work", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  await modules.getByRole("link", { name: "CRM", exact: true }).click();
  await expect(page).toHaveURL(/\/crm$/, { timeout: navigationTimeout });
  await expect(
    page.getByRole("heading", { name: "Customer relationships" }),
  ).toBeVisible();
  await expect(
    modules.getByRole("link", { name: "CRM", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  await expect(
    page.getByRole("navigation", { name: "Workspace boards" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "Settings", exact: true }).first(),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Approvals", exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Customer relationships" }),
  ).toBeVisible();
  await expect(page.locator(".shell-module-rail")).toBeVisible();
  await expect(page.locator(".shell-context-search")).toBeVisible();
  await page
    .getByRole("button", { name: "Switch module, current module CRM" })
    .click();
  await expect(
    page.getByRole("menuitem", { name: /Work Projects and tasks/ }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await page.locator(".shell-context-search").click();
  await expect(
    page.getByRole("dialog", { name: "Search your workspace" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await page.screenshot({ path: "../../artifacts/modules/crm-desktop.png" });
  await page.getByRole("switch", { name: "Dark mode", exact: true }).check();
  await expect(
    page.getByRole("switch", { name: "Dark mode", exact: true }),
  ).toHaveAttribute("aria-disabled", "false");
  await page.screenshot({ path: "../../artifacts/modules/sidebar-dark.png" });
  await page.getByRole("switch", { name: "Dark mode", exact: true }).uncheck();
  await expect(
    page.getByRole("switch", { name: "Dark mode", exact: true }),
  ).toHaveAttribute("aria-disabled", "false");
  await page.getByRole("button", { name: "Toggle navigation" }).click();
  await expect(page.locator(".shell-context-panel")).toBeHidden();
  await expect(
    modules.getByRole("link", { name: "CRM", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /^Account menu/ }),
  ).toBeVisible();
  await page.keyboard.press("Control+k");
  await expect(
    page.getByRole("dialog", { name: "Search your workspace" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Toggle navigation" }).click();
  await expect(page.locator(".shell-context-panel")).toBeVisible();
  await page.getByRole("link", { name: "Open Work boards" }).click();
  await expect(page).toHaveURL(/\/boards$/, { timeout: navigationTimeout });
  await expect(
    page.getByRole("navigation", { name: "Workspace boards" }),
  ).toBeVisible();
  expect(
    await getDatabase().board.count({ where: { id: board, name: "Launch" } }),
  ).toBe(1);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Toggle navigation" }).click();
  await page
    .getByRole("button", { name: "Search workspace", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Search your workspace" }),
  ).toBeVisible();
  await expect(
    page.getByRole("dialog", { name: "Sidebar", exact: true }),
  ).toHaveCount(0);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Toggle navigation" }).click();
  await page.screenshot({ path: "../../artifacts/modules/sidebar-mobile.png" });
  await page
    .getByRole("navigation", { name: "Modules", exact: true })
    .getByRole("link", { name: "CRM", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Customer relationships" }),
  ).toBeVisible();
  await expect(
    page.getByRole("dialog", { name: "Sidebar", exact: true }),
  ).toHaveCount(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: "../../artifacts/modules/crm-mobile.png" });
  const anonymous = await browser.newContext();
  const visitor = await anonymous.newPage();
  await visitor.goto("/crm");
  await expect(visitor).toHaveURL(/\/sign-in/, { timeout: navigationTimeout });
  await expect(
    visitor.getByRole("heading", { name: "Customer relationships" }),
  ).toHaveCount(0);
  await anonymous.close();
});
