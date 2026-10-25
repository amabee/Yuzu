import { test, expect, type Page } from "@playwright/test";
import { getDatabase } from "@yuzu/database";
import { readFile } from "node:fs/promises";
import { parseImportCsv } from "../src/lib/csv-import";
import { startTestCsvWorker, stopTestCsvWorker } from "./csv-worker-process";

process.env.DATABASE_URL = process.env.YUZU_E2E_DATABASE_URL;
const ORIGIN = "http://127.0.0.1:3100";
const shots = process.env.YUZU_CRM_SHOTS;

test.beforeAll(() => startTestCsvWorker());
test.afterAll(() => stopTestCsvWorker());
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
    },
  });
  return { user, workspace };
}
const shot = async (page: Page, name: string) => {
  if (shots) await page.screenshot({ path: `${shots}/${name}.png` });
};
/** The workspace's collection of a type, created by opening its screen. */
async function crmBoard(
  page: Page,
  workspaceId: string,
  type: "COMPANY" | "CONTACT",
) {
  await page.goto(type === "COMPANY" ? "/crm/companies" : "/crm/contacts");
  await page.goBack();
  return (
    await getDatabase().board.findFirstOrThrow({
      where: { workspaceId, recordType: type },
    })
  ).id;
}
const grid = (page: Page) => page.getByRole("grid", { name: "Companies" });
const row = (page: Page, name: string) =>
  grid(page).getByRole("row").filter({ hasText: name });

test("companies are added, edited in the grid and opened as record cards", async ({
  page,
}) => {
  await owner(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/crm/companies");
  await expect(
    page.getByRole("heading", { name: "Companies", level: 1 }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Companies" })).toHaveAttribute(
    "aria-current",
    "page",
  );

  // Add from the last row; the second similar name gets a look-alike hint.
  const add = page.getByRole("textbox", { name: "Add company" });
  await add.fill("Northwind Trading");
  await add.press("Enter");
  await expect(row(page, "Northwind Trading")).toBeVisible();
  await add.fill("Northwind Corp");
  await expect(
    page.getByRole("region", { name: "Similar records" }),
  ).toContainText("Northwind Trading");
  await shot(page, "familiar");
  await add.press("Enter");
  await expect(
    page.getByText("Press Enter again to add it anyway."),
  ).toBeVisible();
  await add.press("Enter");
  await expect(row(page, "Northwind Corp")).toBeVisible();
  await add.fill("Bluebird Health");
  await add.press("Enter");
  await expect(row(page, "Bluebird Health")).toBeVisible();

  // Type straight into a cell; mistakes are caught in place.
  const domain = row(page, "Bluebird Health").getByRole("gridcell").nth(1);
  await domain.click();
  await domain.press("h");
  await page.keyboard.type("ttps://bluebird.example/x");
  await page.keyboard.press("Enter");
  await expect(grid(page).getByRole("alert")).toContainText(
    "Enter just the domain",
  );
  await page.getByRole("textbox", { name: "Domain" }).fill("Bluebird.Example");
  await page.keyboard.press("Enter");
  await expect(domain).toHaveText("bluebird.example");
  // Enter saved and moved down a row, as in a spreadsheet.
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Enter");
  await page.keyboard.type("hello@bluebird.example");
  await page.keyboard.press("Tab");
  await expect(row(page, "Bluebird Health")).toContainText(
    "hello@bluebird.example",
  );
  await shot(page, "grid");
  await page.reload();
  await expect(row(page, "Bluebird Health")).toContainText("bluebird.example");

  // Open the record card: details, notes, updates and its log.
  await row(page, "Bluebird Health")
    .getByRole("button", { name: "Open Bluebird Health" })
    .click();
  const card = page.getByRole("dialog");
  await expect(card.getByRole("textbox", { name: "Company name" })).toHaveValue(
    "Bluebird Health",
  );
  await expect(page).toHaveURL(/record=/);
  await card.getByLabel("Main phone").fill("+63 32 555 0199");
  await card.getByLabel("Main phone").press("Enter");
  await card.getByLabel("Notes").fill("Buys quarterly.");
  await card.getByRole("tab", { name: "Overview" }).click();
  await card
    .getByRole("textbox", { name: "New comment" })
    .fill("Called their CFO.");
  await card.getByRole("button", { name: /^(Send|Post|Comment)/ }).click();
  await expect(card.getByText("Called their CFO.")).toBeVisible();
  await shot(page, "card");
  await card.getByRole("tab", { name: "Activity log" }).click();
  await expect(card.getByText("+63 32 555 0199")).toBeVisible();
  await card.getByRole("button", { name: "Next company" }).click();
  await expect(card.getByRole("textbox", { name: "Company name" })).toHaveValue(
    "Northwind Corp",
  );
  await page.keyboard.press("Escape");
  await expect(card).toBeHidden();
  await expect(page).not.toHaveURL(/record=/);

  // A shared link opens the record again; archiving moves it to Archived.
  const record = await getDatabase().task.findFirstOrThrow({
    where: { name: "Bluebird Health" },
  });
  await page.goto(`/crm/companies?record=${record.id}`);
  await expect(card.getByRole("textbox", { name: "Company name" })).toHaveValue(
    "Bluebird Health",
  );
  await expect(card.getByLabel("Notes")).toHaveValue("Buys quarterly.");
  await page.emulateMedia({ colorScheme: "dark" });
  await shot(page, "card-dark");
  await page.emulateMedia({ colorScheme: "light" });
  await card.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: "Archive" }).click();
  await expect(card.getByText("Archived · read-only")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(row(page, "Bluebird Health")).toBeHidden();
  await page.getByRole("button", { name: "Archived" }).click();
  await expect(row(page, "Bluebird Health")).toBeVisible();

  // Collections stay out of Work, and old board links land in CRM.
  await page.goto("/boards");
  await expect(page.getByRole("link", { name: "Companies" })).toHaveCount(0);
  await page.goto(`/boards/${record.boardId}?task=${record.id}`);
  await expect(page).toHaveURL(/\/crm\/companies\?record=/);
});

test("contacts edit owners inline and keep companies' fields to themselves", async ({
  page,
}) => {
  const { workspace } = await owner(page);
  await page.goto("/crm/contacts");
  const add = page.getByRole("textbox", { name: "Add contact" });
  await add.fill("Ana Reyes");
  await add.press("Enter");
  const contacts = page.getByRole("grid", { name: "Contacts" });
  const ana = contacts.getByRole("row").filter({ hasText: "Ana Reyes" });
  await expect(ana).toBeVisible();
  await expect(
    contacts.getByRole("columnheader", { name: "Domain" }),
  ).toHaveCount(0);
  const ownerCell = ana.getByRole("gridcell").nth(4);
  await ownerCell.dblclick();
  await page
    .getByRole("combobox", { name: "Owner" })
    .selectOption({ label: "No owner" });
  await expect(ownerCell).toHaveText("No owner");
  // The API rejects company-only fields on contacts.
  const board = await getDatabase().board.findFirstOrThrow({
    where: { workspaceId: workspace.id, recordType: "CONTACT" },
  });
  const response = await post(page, "/api/v1/boards/create-task", {
    boardId: board.id,
    createKey: crypto.randomUUID(),
    name: "Leo Tan",
    domain: "example.com",
  });
  expect(response.status()).toBe(422);
  expect((await response.json()).error.code).toBe("FIELD_NOT_AVAILABLE");

  await page.setViewportSize({ width: 375, height: 812 });
  await page.reload();
  await expect(
    page.evaluate(() => document.documentElement.scrollWidth),
  ).resolves.toBeLessThanOrEqual(375);
  await contacts.getByRole("button", { name: "Open Ana Reyes" }).click();
  await expect(page.getByRole("dialog").getByLabel("Email")).toBeVisible();
  await shot(page, "mobile-card");
});

test("contacts link companies with roles, a primary, and stacked cards", async ({
  page,
}) => {
  const { workspace } = await owner(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/crm/companies");
  const add = page.getByRole("textbox", { name: "Add company" });
  for (const name of ["Northwind Trading", "Acme Labs"]) {
    await add.fill(name);
    await add.press("Enter");
    await expect(row(page, name)).toBeVisible();
  }
  await page.goto("/crm/contacts");
  const addContact = page.getByRole("textbox", { name: "Add contact" });
  await addContact.fill("Ana Reyes");
  await addContact.press("Enter");
  const contacts = page.getByRole("grid", { name: "Contacts" });
  await contacts.getByRole("button", { name: "Open Ana Reyes" }).click();
  const card = page.getByRole("dialog");
  const companies = card.getByRole("region", { name: "Companies" });
  await expect(companies).toContainText("No companies");

  // Link two companies, one with a role, then choose the primary.
  for (const [name, role] of [
    ["Northwind Trading", "Head of operations"],
    ["Acme Labs", ""],
  ]) {
    await companies.getByRole("button", { name: "Link company" }).click();
    await card
      .getByRole("searchbox", { name: "Find a company" })
      .fill(name.split(" ")[0]!);
    if (role)
      await card.getByRole("textbox", { name: "Role (optional)" }).fill(role);
    await card
      .getByRole("group", { name: "Link a company" })
      .getByRole("button", { name: new RegExp(name) })
      .click();
    await expect(
      companies.getByRole("button", { name: `Open ${name}` }),
    ).toBeVisible();
  }
  await expect(
    companies.getByRole("textbox", { name: "Role at Northwind Trading" }),
  ).toHaveValue("Head of operations");
  const northwindRow = companies
    .getByRole("listitem")
    .filter({ hasText: "Northwind Trading" });
  await northwindRow.getByRole("button", { name: "Make primary" }).click();
  await expect(
    northwindRow.getByRole("button", { name: "Primary", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  const acmeRow = companies
    .getByRole("listitem")
    .filter({ hasText: "Acme Labs" });
  await acmeRow
    .getByRole("textbox", { name: "Role at Acme Labs" })
    .fill("Advisor");
  await acmeRow
    .getByRole("textbox", { name: "Role at Acme Labs" })
    .press("Enter");
  await acmeRow
    .getByRole("combobox", { name: "Status at Acme Labs" })
    .selectOption("FORMER");
  await expect(
    companies
      .locator('[data-status="Former"]')
      .getByRole("button", { name: "Open Acme Labs" }),
  ).toBeVisible();

  // Following a link stacks the company's card; Escape steps back.
  await companies
    .getByRole("button", { name: "Open Northwind Trading" })
    .click();
  await expect(card.getByRole("textbox", { name: "Company name" })).toHaveValue(
    "Northwind Trading",
  );
  await expect(
    card.getByRole("navigation", { name: "Open records" }),
  ).toContainText("Ana Reyes");
  const people = card.getByRole("region", { name: "People" });
  await expect(
    people.getByRole("listitem").filter({ hasText: "Ana Reyes" }),
  ).toContainText("Primary company");
  await shot(page, "stacked");
  await page.keyboard.press("Escape");
  await expect(card.getByRole("textbox", { name: "Full name" })).toHaveValue(
    "Ana Reyes",
  );

  // Removing the primary link asks once more, then clears the primary.
  await northwindRow
    .getByRole("button", { name: "Remove link to Northwind Trading" })
    .click();
  await expect(northwindRow.getByRole("alert")).toContainText(
    "also clears it as primary",
  );
  await northwindRow
    .getByRole("button", { name: "Remove link", exact: true })
    .click();
  await expect(
    companies.getByRole("button", { name: "Open Northwind Trading" }),
  ).toHaveCount(0);
  await card.getByRole("tab", { name: "Activity log" }).click();
  await expect(card.getByText("unlinked Northwind Trading")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(card).toBeHidden();

  // With approvals on the Contacts board, links stay visible but can't change.
  const db = getDatabase();
  const board = await db.board.findFirstOrThrow({
    where: { workspaceId: workspace.id, recordType: "CONTACT" },
  });
  await db.boardApprovalPolicy.create({
    data: { boardId: board.id, enabled: true },
  });
  // Set directly here, so nothing announces it; the app would refresh live.
  await page.reload();
  await contacts.getByRole("button", { name: "Open Ana Reyes" }).click();
  await expect(companies.getByRole("status")).toContainText(
    "approvals turned on",
  );
  await expect(
    companies.getByRole("button", { name: "Link company" }),
  ).toHaveCount(0);
  await expect(
    companies.getByRole("button", { name: "Open Acme Labs" }),
  ).toBeVisible();
});

test("companies import from CSV with duplicate checks and export with readable links", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const { workspace } = await owner(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/crm/companies");
  const db = getDatabase();
  const board = await db.board.findFirstOrThrow({
    where: { workspaceId: workspace.id, recordType: "COMPANY" },
  });
  await post(page, "/api/v1/boards/create-task", {
    boardId: board.id,
    createKey: crypto.randomUUID(),
    name: "Northwind Trading",
    domain: "north.example",
  });

  await page.getByRole("button", { name: "Import CSV", exact: true }).click();
  const panel = page.getByRole("dialog");
  await expect(panel).toContainText("Bring your companies into Yuzu");
  const choose = page.waitForEvent("filechooser");
  await panel.getByLabel("CSV file").click();
  await (
    await choose
  ).setFiles({
    name: "companies.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(
      [
        "Company,Domain,Main email,Owner",
        "Northwind (new office),NORTH.example,,Team Owner",
        "Acme Labs,acme.example,sales@acme.example,Team Owner",
        "Broken Co,https://broken.example/x,not-an-email,",
      ].join("\r\n"),
    ),
  });
  await panel
    .getByRole("button", { name: "Preview companies", exact: true })
    .click();
  await expect(
    panel.getByText("3 rows · 1 invalid · 1 possible duplicates"),
  ).toBeVisible({ timeout: 30_000 });
  await expect(panel).toContainText("Enter just the domain");
  await shot(page, "import-preview");
  await panel
    .getByRole("button", { name: "Import 1 company", exact: true })
    .click();
  await expect(row(page, "Acme Labs")).toBeVisible({ timeout: 30_000 });
  await expect(row(page, "Acme Labs")).toContainText("sales@acme.example");
  await expect(row(page, "Northwind (new office)")).toHaveCount(0);

  // Link a contact, then export: links come out as read-only text.
  const contacts = await crmBoard(page, workspace.id, "CONTACT");
  const ana = (
    await (
      await post(page, "/api/v1/boards/create-task", {
        boardId: contacts,
        createKey: crypto.randomUUID(),
        name: "Ana Reyes",
      })
    ).json()
  ).data.taskId;
  const acme = await db.task.findFirstOrThrow({ where: { name: "Acme Labs" } });
  expect(
    (
      await post(page, "/api/v1/crm/link", {
        contactId: ana,
        companyId: acme.id,
        role: "=Buyer",
        requestKey: crypto.randomUUID(),
      })
    ).status(),
  ).toBe(200);
  await page.getByRole("button", { name: "Export CSV", exact: true }).click();
  const activity = page.getByRole("region", { name: "Transfer progress" });
  await expect(
    activity.getByText("Ready to download", { exact: true }),
  ).toBeVisible({ timeout: 30_000 });
  const downloaded = page.waitForEvent("download");
  await activity
    .getByRole("link", { name: "Download CSV", exact: true })
    .click();
  const download = await downloaded;
  expect(download.suggestedFilename()).toMatch(/^yuzu-Companies-.*\.csv$/u);
  const text = await readFile((await download.path())!, "utf8");
  const { headers, rows } = parseImportCsv(text);
  expect(headers.slice(0, 3)).toEqual(["Company ID", "Company", "Domain"]);
  const records = rows.map((cells) =>
    Object.fromEntries(headers.map((name, index) => [name, cells[index]])),
  );
  expect(records.find((item) => item.Company === "Acme Labs")).toMatchObject({
    Domain: "acme.example",
    "Main email": "sales@acme.example",
    "People (read-only)": "Ana Reyes (=Buyer, Current)",
  });
});

test("CRM screens update live across both collections without a reload", async ({
  page,
}) => {
  const { workspace } = await owner(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  const companies = await crmBoard(page, workspace.id, "COMPANY");
  const contacts = await crmBoard(page, workspace.id, "CONTACT");
  const make = async (boardId: string, name: string) =>
    (
      await (
        await post(page, "/api/v1/boards/create-task", {
          boardId,
          createKey: crypto.randomUUID(),
          name,
        })
      ).json()
    ).data.taskId as string;
  const north = await make(companies, "Northwind");
  const acme = await make(companies, "Acme Labs");
  const ana = await make(contacts, "Ana Reyes");
  const linked = (
    await (
      await post(page, "/api/v1/crm/link", {
        contactId: ana,
        companyId: north,
        requestKey: crypto.randomUUID(),
      })
    ).json()
  ).data;
  expect(
    (
      await post(page, "/api/v1/crm/primary", {
        contactId: ana,
        linkId: linked.linkId,
        primaryRevision: 0,
        requestKey: crypto.randomUUID(),
      })
    ).status(),
  ).toBe(200);

  await page.goto("/crm/contacts");
  // Both subscriptions are live: this collection and the companies.
  await expect(page.locator('[data-connection="live"]')).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.locator('[data-related-connection="live"]')).toBeVisible({
    timeout: 15_000,
  });
  const contactsGrid = page.getByRole("grid", { name: "Contacts" });
  const anaRow = contactsGrid.getByRole("row").filter({ hasText: "Ana Reyes" });
  await expect(anaRow).toContainText("Northwind");

  // Someone renames the company elsewhere: the contact's primary updates.
  // (Live updates arrive in seconds; the fallback refresh takes a minute.)
  const live = { timeout: 8_000 };
  const company = await getDatabase().task.findUniqueOrThrow({
    where: { id: north },
  });
  expect(
    (
      await post(page, "/api/v1/boards/update", {
        taskId: north,
        revision: company.revision,
        changes: { name: "Northwind Trading" },
      })
    ).status(),
  ).toBe(200);
  await expect(anaRow).toContainText("Northwind Trading", live);

  // A new link appears on the open card, and a new contact in the grid.
  await contactsGrid.getByRole("button", { name: "Open Ana Reyes" }).click();
  const card = page.getByRole("dialog");
  const links = card.getByRole("region", { name: "Companies" });
  await expect(links).toContainText("Northwind Trading");
  await post(page, "/api/v1/crm/link", {
    contactId: ana,
    companyId: acme,
    role: "Advisor",
    requestKey: crypto.randomUUID(),
  });
  await expect(
    links.getByRole("button", { name: "Open Acme Labs" }),
  ).toBeVisible(live);
  await page.keyboard.press("Escape");
  await make(contacts, "Leo Tan");
  await expect(
    contactsGrid.getByRole("row").filter({ hasText: "Leo Tan" }),
  ).toBeVisible(live);

  // On Companies, a contact card stacked over a company follows the
  // contact's own collection too.
  await page.goto(`/crm/companies?record=${acme}`);
  await expect(page.locator('[data-related-connection="live"]')).toBeVisible({
    timeout: 15_000,
  });
  const people = card.getByRole("region", { name: "People" });
  await people.getByRole("button", { name: "Open Ana Reyes" }).click();
  await expect(card.getByRole("textbox", { name: "Full name" })).toHaveValue(
    "Ana Reyes",
  );
  const person = await getDatabase().task.findUniqueOrThrow({
    where: { id: ana },
  });
  await post(page, "/api/v1/boards/update", {
    taskId: ana,
    revision: person.revision,
    changes: { email: "ana@acme.example" },
  });
  await expect(
    card.getByRole("textbox", { name: "Email", exact: true }),
  ).toHaveValue("ana@acme.example", live);
});
