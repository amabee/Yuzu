import { test, expect, type Page } from "@playwright/test";
import { createRecordId, getDatabase } from "@yuzu/database";

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
const RAE_PASSWORD = "rae-approver-password-123";
/** A workspace member who can sign in and approve. */
async function approver(workspaceId: string) {
  const id = createRecordId();
  return getDatabase().user.create({
    data: {
      id,
      name: "Rae Approver",
      email: "rae@example.test",
      emailVerified: true,
      accounts: {
        create: {
          accountId: id,
          providerId: "credential",
          password: await (
            await import("better-auth/crypto")
          ).hashPassword(RAE_PASSWORD),
        },
      },
      memberships: { create: { workspaceId } },
    },
  });
}

test("pipelines move deals through stages with history, customers and settings", async ({
  page,
  browser,
}) => {
  test.setTimeout(150_000);
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

  // Approvals: the owner turns them on in pipeline settings, with Rae as
  // the approver. Closing a deal then waits for her.
  const rae = await approver(workspace.id);
  await page.reload();
  await page.getByRole("button", { name: "Pipeline settings" }).click();
  const approvals = page
    .getByRole("dialog", { name: "Pipeline settings" })
    .getByRole("region", { name: "Approvals" });
  await approvals
    .getByRole("combobox", { name: "Approver" })
    .selectOption({ label: "Rae Approver" });
  await expect(
    approvals.getByRole("combobox", { name: "Approver" }),
  ).toHaveValue(rae.id);
  // The switch shows what the server saved.
  await approvals.getByRole("checkbox", { name: "Off" }).click();
  await expect(approvals.getByRole("checkbox", { name: "On" })).toBeChecked();
  await expect(
    approvals.getByRole("radio", { name: /Closing and reopening/ }),
  ).toBeChecked();
  await shot(page, "pipeline-approvals");
  await page.keyboard.press("Escape");
  await expect(
    page.getByText("Closing and reopening deals needs approval here."),
  ).toBeVisible();

  await page.getByRole("tab", { name: "Board" }).click();
  await lane(page, "Proposal")
    .getByRole("button", { name: "Clinic kits" })
    .click();
  await card
    .getByRole("navigation", { name: "Stage" })
    .getByRole("button", { name: "Won" })
    .click();
  const ask = page.getByRole("dialog", { name: "Request a move to Won?" });
  await expect(ask).toContainText("Rae Approver approves stage changes");
  await ask
    .getByLabel("Note for the approver (optional)")
    .fill("PO signed, countersigned copy on the way");
  await ask.getByRole("button", { name: "Send request" }).click();
  await expect(
    card.getByText("You asked to move this deal to Won"),
  ).toBeVisible();
  await expect(
    card
      .getByRole("navigation", { name: "Stage" })
      .getByRole("button", { name: "Proposal" }),
  ).toHaveAttribute("aria-current", "step");
  await expect(
    card
      .getByRole("navigation", { name: "Stage" })
      .getByRole("button", { name: "Lost" }),
  ).toBeDisabled();
  await shot(page, "deal-request");
  await page.keyboard.press("Escape");
  await expect(
    lane(page, "Won").getByRole("button", {
      name: "Requested move: Clinic kits, from Proposal",
    }),
  ).toBeVisible();
  await expect(
    lane(page, "Proposal").getByRole("button", {
      name: /Clinic kits.*waiting for approval to move to Won/,
    }),
  ).toBeVisible();
  await shot(page, "deals-board-waiting");

  // Rae decides from her own browser; the board updates for both of them.
  const clinic = await db.task.findFirstOrThrow({
    where: { boardId: board.id, name: "Clinic kits" },
  });
  const raeContext = await browser.newContext();
  const raePage = await raeContext.newPage();
  expect(
    (
      await post(raePage, "/api/v1/session/sign-in", {
        email: rae.email,
        password: RAE_PASSWORD,
      })
    ).status(),
  ).toBe(200);
  await raePage.goto(`/crm/deals/${board.id}?record=${clinic.id}`);
  const raeCard = raePage.getByRole("dialog");
  await expect(
    raeCard.getByText("Team Owner asked to move this deal to Won"),
  ).toBeVisible();
  await expect(
    raeCard.getByText("PO signed, countersigned copy on the way"),
  ).toBeVisible();
  await raeCard.getByRole("button", { name: "Approve move" }).click();
  await expect(
    raeCard
      .getByRole("navigation", { name: "Stage" })
      .getByRole("button", { name: "Won" }),
  ).toHaveAttribute("aria-current", "step");
  await expect(
    raeCard.getByText("Team Owner, approved by Rae Approver").first(),
  ).toBeVisible();
  await raeContext.close();
  await expect(
    lane(page, "Won").getByRole("button", { name: /^Clinic kits/ }),
  ).toBeVisible();

  // The approvals page names the move.
  await page.goto("/approvals");
  await page
    .getByRole("combobox", { name: "Filter approval requests" })
    .selectOption("ALL");
  await expect(page.getByText("Move deal · New business")).toBeVisible();
  await page.goto(`/crm/deals/${board.id}`);
  await expect(
    page.getByRole("heading", { name: "New business", level: 1 }),
  ).toBeVisible();

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
