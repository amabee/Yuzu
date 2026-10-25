import { test, expect, type Page } from "@playwright/test";
import { getDatabase } from "@yuzu/database";

process.env.DATABASE_URL = process.env.YUZU_E2E_DATABASE_URL;
const ORIGIN = "http://127.0.0.1:3100";
const shots = process.env.YUZU_CRM_SHOTS;

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
  await db.boardProposal.deleteMany();
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
      currency: "PHP",
    },
  });
  return { user, workspace };
}
const shot = async (page: Page, name: string) => {
  if (shots) await page.screenshot({ path: `${shots}/${name}.png` });
};
const lane = (page: Page, name: string) =>
  page.getByRole("group", { name: new RegExp(`^${name}, `) });

test("pipelines move deals through stages with history, customers and settings", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const { workspace } = await owner(page);
  await page.setViewportSize({ width: 1440, height: 900 });

  // Start a pipeline; it appears under Deals in the CRM sidebar.
  await page.goto("/crm/deals");
  await expect(page.getByText("No pipelines yet")).toBeVisible();
  await page.getByLabel("New pipeline").fill("New business");
  await page.getByRole("button", { name: "Create pipeline" }).click();
  await expect(page).toHaveURL(/\/crm\/deals\/[0-9a-f-]+$/);
  await expect(
    page.getByRole("heading", { name: "New business", level: 1 }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("navigation", { name: "Main navigation" })
      .getByRole("link", {
        name: "New business",
      }),
  ).toBeVisible();
  const db = getDatabase();
  const board = await db.board.findFirstOrThrow({
    where: { workspaceId: workspace.id, pipeline: { isNot: null } },
  });
  const companies = (
    await (
      await page.request.get(
        `/api/v1/crm/directory?workspaceId=${workspace.id}&query=${encodeURIComponent(JSON.stringify({ type: "COMPANY" }))}`,
      )
    ).json()
  ).data.boardId;
  await post(page, "/api/v1/boards/create-task", {
    boardId: companies,
    createKey: crypto.randomUUID(),
    name: "Northwind Trading",
  });

  // Add deals inline in the New lane.
  for (const name of ["POS rollout", "Clinic kits"]) {
    await lane(page, "New").getByRole("button", { name: "+ Add deal" }).click();
    const input = page.getByRole("textbox", { name: "New deal in New" });
    await input.fill(name);
    await input.press("Enter");
    await expect(lane(page, "New").getByRole("button", { name })).toBeVisible();
    await input.press("Escape");
  }

  // Drag a card to the next stage.
  await lane(page, "New")
    .getByRole("button", { name: "Clinic kits" })
    .dragTo(lane(page, "Qualified"));
  await expect(
    lane(page, "Qualified").getByRole("button", { name: "Clinic kits" }),
  ).toBeVisible();
  await shot(page, "deals-board");

  // Open a deal: value, customer, stage path and history.
  await lane(page, "New").getByRole("button", { name: "POS rollout" }).click();
  const card = page.getByRole("dialog");
  await expect(card.getByRole("textbox", { name: "Deal name" })).toHaveValue(
    "POS rollout",
  );
  await card.getByLabel("Amount").fill("480,000");
  await card.getByLabel("Amount").press("Enter");
  await card.getByRole("button", { name: "Choose" }).click();
  await card.getByRole("searchbox", { name: "Find a company" }).fill("North");
  await card
    .getByRole("group", { name: "Choose a customer" })
    .getByRole("button", { name: /Northwind Trading/ })
    .click();
  await expect(
    card.getByRole("button", { name: "Open Northwind Trading" }),
  ).toBeVisible();
  const path = card.getByRole("navigation", { name: "Stage" });
  await path.getByRole("button", { name: "Won" }).click();
  await expect(path.getByRole("button", { name: "Won" })).toHaveAttribute(
    "aria-current",
    "step",
  );
  await expect(card.getByText("Marked won")).toBeVisible();
  await path.getByRole("button", { name: "Lost" }).click();
  const reason = page.getByRole("dialog", { name: "Move to Lost?" });
  await reason.getByLabel("Reason").fill("Customer cancelled before signing");
  await reason.getByRole("button", { name: "Move deal" }).click();
  await expect(
    card.getByText("Customer cancelled before signing"),
  ).toBeVisible();
  await expect(card.getByText("₱480,000").first()).toBeVisible();
  await shot(page, "deal-card");

  // The customer's card lists the deal; opening it stacks the deal again.
  await card.getByRole("button", { name: "Open Northwind Trading" }).click();
  await expect(card.getByRole("textbox", { name: "Company name" })).toHaveValue(
    "Northwind Trading",
  );
  const deals = card.getByRole("region", { name: "Deals" });
  await expect(deals).toContainText("POS rollout");
  await expect(deals).toContainText("Lost");
  await page.keyboard.press("Escape");
  await expect(card.getByRole("textbox", { name: "Deal name" })).toHaveValue(
    "POS rollout",
  );
  await page.keyboard.press("Escape");
  await expect(card).toBeHidden();
  await expect(
    lane(page, "Lost").getByRole("button", { name: /POS rollout/ }),
  ).toBeVisible();

  // Table view changes stages too.
  await page.getByRole("tab", { name: "Table" }).click();
  await page
    .getByRole("combobox", { name: "Stage of Clinic kits" })
    .selectOption({
      label: "Proposal",
    });
  await expect(
    page.getByRole("combobox", { name: "Stage of Clinic kits" }),
  ).toHaveValue(
    (
      await db.pipelineStage.findFirstOrThrow({
        where: { boardId: board.id, name: "Proposal" },
      })
    ).id,
  );

  // Pipeline settings: add a stage, and explain what can't be removed.
  await page.getByRole("button", { name: "Pipeline settings" }).click();
  const settings = page.getByRole("dialog", { name: "Pipeline settings" });
  await settings.getByRole("textbox", { name: "New open stage" }).fill("Demo");
  await settings.getByRole("button", { name: "Add" }).first().click();
  await expect(
    settings.getByRole("textbox", { name: "Stage name" }).nth(4),
  ).toHaveValue("Demo");
  await settings.getByRole("button", { name: "Remove Won" }).click();
  await expect(settings.getByRole("alert")).toContainText(
    "at least one Won stage",
  );
  await settings.getByRole("button", { name: "Remove Proposal" }).click();
  await expect(settings.getByRole("alert")).toContainText(
    "1 deal is in this stage",
  );
  await expect(settings.getByRole("alert")).toContainText("Clinic kits");
  await shot(page, "pipeline-settings");
  await page.keyboard.press("Escape");

  // Pipelines stay out of Work; old board links land in CRM.
  await page.goto("/boards");
  await expect(page.getByRole("link", { name: "New business" })).toHaveCount(0);
  await page.goto(`/boards/${board.id}`);
  await expect(page).toHaveURL(new RegExp(`/crm/deals/${board.id}`));

  // With approvals on, stage moves pause and say why.
  await db.boardApprovalPolicy.create({
    data: { boardId: board.id, enabled: true },
  });
  await page.reload();
  await expect(
    page.getByText("Stage moves are paused on this pipeline."),
  ).toBeVisible();
  await page.getByRole("tab", { name: "Board" }).click();
  await lane(page, "Proposal")
    .getByRole("button", { name: "Clinic kits" })
    .click();
  await expect(
    card
      .getByRole("navigation", { name: "Stage" })
      .getByRole("button", { name: "Won" }),
  ).toBeDisabled();
  await page.keyboard.press("Escape");

  await page.emulateMedia({ colorScheme: "dark" });
  await shot(page, "deals-board-dark");
  await page.emulateMedia({ colorScheme: "light" });
  await page.setViewportSize({ width: 375, height: 812 });
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "New business", level: 1 }),
  ).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(375);
  await shot(page, "deals-mobile");
});
