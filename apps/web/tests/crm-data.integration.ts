import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createRecordId, getDatabase } from "@yuzu/database";
import {
  createTaskInTransaction,
  mutateTaskInTransaction,
  serial,
} from "@/server/board-service";
import { decideApprovalInTransaction } from "@/server/approval-service";
import {
  crmCollection,
  crmDirectoryFor,
  crmMatchesFor,
  crmRecordFor,
} from "@/server/crm-service";
import {
  deleteRecordInTransaction,
  eraseBatch,
  eraseSelection,
  restoreRecordInTransaction,
} from "@/server/trash-service";
import { refuseCrmCollection } from "@/server/crm-profile";
import {
  crmLinksFor,
  linkCompanyInTransaction,
  removeLinkInTransaction,
  setPrimaryInTransaction,
  updateLinkInTransaction,
} from "@/server/crm-links-service";

const db = getDatabase();
const workspaceIds: string[] = [],
  userIds: string[] = [];
beforeAll(async () => {
  if (new URL(process.env.DATABASE_URL!).pathname !== "/yuzu_e2e")
    throw new Error("Refusing a non-test database.");
  const migrated = spawnSync("pnpm db:deploy", {
    shell: true,
    cwd: fileURLToPath(new URL("../../../", import.meta.url)),
    env: process.env,
    stdio: "pipe",
  });
  if (migrated.status !== 0)
    throw new Error("Could not migrate the isolated CRM test database.");
  await db.installationSettings.upsert({
    where: { id: "installation" },
    create: { setupState: "READY" },
    update: { setupState: "READY", maintenanceMode: false },
  });
});
afterAll(async () => {
  // Only fixtures created by this file, and only yuzu_e2e. No dev-data reset.
  const boards = { board: { workspaceId: { in: workspaceIds } } };
  await db.boardProposal.deleteMany({ where: boards });
  await db.task.deleteMany({ where: boards });
  await db.board.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
  await db.project.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
  await db.workspace.deleteMany({ where: { id: { in: workspaceIds } } });
  await db.user.deleteMany({ where: { id: { in: userIds } } });
  await db.$disconnect();
});

async function fixture() {
  const people = await Promise.all(
    ["member", "teammate", "admin", "outsider"].map((name) =>
      db.user.create({
        data: {
          name,
          email: `${createRecordId()}@crm.test`,
          emailVerified: true,
          role: name === "admin" ? "ADMIN" : "MEMBER",
        },
      }),
    ),
  );
  const [member, teammate, admin, outsider] = people;
  userIds.push(...people.map((person) => person.id));
  const workspace = await db.workspace.create({
    data: {
      name: "CRM integration",
      createdById: admin.id,
      members: {
        create: [member, teammate].map((person) => ({ userId: person.id })),
      },
    },
  });
  workspaceIds.push(workspace.id);
  const companies = await crmCollection(member, workspace.id, "COMPANY");
  const contacts = await crmCollection(member, workspace.id, "CONTACT");
  return { member, teammate, admin, outsider, workspace, companies, contacts };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
const create = (
  boardId: string,
  userId: string,
  values: Record<string, unknown> = {},
) =>
  serial((tx) =>
    createTaskInTransaction(
      tx,
      { boardId, createKey: createRecordId(), name: "Northwind", ...values },
      userId,
    ),
  );
const applied = (result: Awaited<ReturnType<typeof create>>) => {
  if (result.outcome !== "APPLIED")
    throw new Error("Expected a direct change.");
  return result.taskId;
};
const update = (
  taskId: string,
  revision: number,
  changes: Record<string, unknown>,
  userId: string,
) =>
  serial((tx) =>
    mutateTaskInTransaction(
      tx,
      "update",
      { taskId, revision, changes },
      userId,
    ),
  );
const raw = (sql: string, ...values: unknown[]) =>
  db.$executeRawUnsafe(sql, ...values);

describe("CRM collections", () => {
  let f: Fixture;
  beforeAll(async () => {
    f = await fixture();
  });

  it("creates one standalone collection of each type per workspace, once", async () => {
    const again = await Promise.all(
      Array.from({ length: 4 }, () =>
        crmCollection(f.teammate, f.workspace.id, "COMPANY"),
      ),
    );
    expect(new Set(again)).toEqual(new Set([f.companies]));
    const board = await db.board.findUniqueOrThrow({
      where: { id: f.companies },
      include: { columns: true, managers: true },
    });
    expect(board).toMatchObject({ recordType: "COMPANY", projectId: null });
    expect(board.managers).toEqual([]);
    expect(board.columns.map((column) => column.key).sort()).toEqual(
      [
        "address",
        "assignees",
        "description",
        "domain",
        "email",
        "legal_name",
        "name",
        "phone",
        "website",
      ].sort(),
    );
    await expect(
      crmCollection(f.outsider, f.workspace.id, "COMPANY"),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      crmDirectoryFor(f.member, { type: "CONTACT" }, f.workspace.id, false),
    ).resolves.toMatchObject({ boardId: f.contacts, total: 0 });
  });

  it("refuses a second collection, a project, a type change and a move", async () => {
    const project = await db.project.create({
      data: {
        workspaceId: f.workspace.id,
        name: `CRM ${createRecordId()}`,
        color: "#336699",
        position: 0,
        createdById: f.admin.id,
      },
    });
    await expect(
      db.board.create({
        data: {
          name: "Companies again",
          workspaceId: f.workspace.id,
          createdById: f.admin.id,
          recordType: "COMPANY",
        },
      }),
    ).rejects.toThrow();
    await expect(
      raw(
        `UPDATE "Board" SET "projectId" = $1 WHERE "id" = $2`,
        project.id,
        f.companies,
      ),
    ).rejects.toThrow(/Board_crm_standalone_check/);
    await expect(
      raw(
        `UPDATE "Board" SET "recordType" = 'TASK' WHERE "id" = $1`,
        f.companies,
      ),
    ).rejects.toThrow(/keep their type/);
    const task = await db.board.create({
      data: {
        name: "Ordinary",
        workspaceId: f.workspace.id,
        createdById: f.admin.id,
      },
    });
    await expect(
      raw(
        `UPDATE "Board" SET "recordType" = 'CONTACT' WHERE "id" = $1`,
        task.id,
      ),
    ).rejects.toThrow(/keep their type/);
    for (const what of ["archive", "move", "fields"])
      await expect(
        refuseCrmCollection({ boardId: f.contacts }, what),
      ).rejects.toMatchObject({ code: "CRM_COLLECTION" });
  });
});

describe("Company and Contact records", () => {
  let f: Fixture;
  beforeAll(async () => {
    f = await fixture();
  });

  it("creates a record from a name alone, with an empty profile", async () => {
    const id = applied(
      await create(f.contacts, f.member.id, { name: "Ana Reyes" }),
    );
    expect(
      await db.contactProfile.findUniqueOrThrow({ where: { recordId: id } }),
    ).toMatchObject({ workspaceId: f.workspace.id, email: null, phone: null });
  });

  it("normalizes profile values and keeps international names", async () => {
    const id = applied(
      await create(f.companies, f.member.id, {
        name: "Café Ñandú 株式会社",
        domain: " Bücher.Example ",
        email: "Sales@North.EXAMPLE",
        website: "https://bücher.example/about",
        legalName: "  ",
        address: "12 Ayala Ave\nMakati City",
        assigneeIds: [f.teammate.id],
      }),
    );
    const record = await crmRecordFor(f.member, { recordId: id });
    expect(record.record).toMatchObject({
      name: "Café Ñandú 株式会社",
      ownerId: f.teammate.id,
      profile: {
        domain: "xn--bcher-kva.example",
        email: "Sales@north.example",
        legalName: null,
        address: "12 Ayala Ave\nMakati City",
      },
    });
    const stored = await db.companyProfile.findUniqueOrThrow({
      where: { recordId: id },
    });
    expect(stored.emailKey).toBe("sales@north.example");
  });

  it("rejects invalid values and fields from the other type", async () => {
    for (const values of [
      { email: "not-an-email" },
      { email: `${"a".repeat(250)}@x.io` },
      { website: "ftp://files.example" },
      { website: "https://user:secret@example.com" },
      { domain: "https://example.com/path" },
      { domain: "*.example.com" },
      { phone: "+63\u0007 917" },
      { name: "x".repeat(201) },
    ])
      await expect(create(f.companies, f.member.id, values)).rejects.toThrow();
    await expect(
      create(f.contacts, f.member.id, { domain: "example.com" }),
    ).rejects.toMatchObject({ code: "FIELD_NOT_AVAILABLE" });
    await expect(
      create(f.contacts, f.member.id, {
        assigneeIds: [f.member.id, f.teammate.id],
      }),
    ).rejects.toMatchObject({ code: "TOO_MANY_ASSIGNEES" });
    await expect(
      create(f.contacts, f.member.id, { statusId: "todo" }),
    ).rejects.toMatchObject({ code: "FIELD_TURNED_OFF" });
    await expect(
      create(f.contacts, f.member.id, { dueDate: "2026-11-01" }),
    ).rejects.toMatchObject({ code: "FIELD_TURNED_OFF" });
  });

  it("keeps profile fields off ordinary boards", async () => {
    const board = await db.board.create({
      data: {
        name: "Tasks",
        workspaceId: f.workspace.id,
        createdById: f.admin.id,
        columns: {
          create: [{ name: "Task", key: "name", type: "TEXT", position: 0 }],
        },
      },
    });
    await expect(
      create(board.id, f.admin.id, { email: "a@b.co" }),
    ).rejects.toMatchObject({ code: "FIELD_NOT_AVAILABLE" });
  });

  it("updates profile fields with revisions and readable activity", async () => {
    const id = applied(await create(f.contacts, f.member.id, { name: "Jun" }));
    await update(
      id,
      1,
      { email: "jun@bluebird.example", phone: "+63 2 555" },
      f.member.id,
    );
    await expect(
      update(id, 1, { phone: "+63 2 556" }, f.member.id),
    ).rejects.toMatchObject({ code: "TASK_CHANGED" });
    const detail = await crmRecordFor(f.member, { recordId: id });
    expect(detail.record.revision).toBe(2);
    expect(detail.record.profile.email).toBe("jun@bluebird.example");
    expect(detail.activity[0]?.changes).toEqual(
      expect.arrayContaining([
        { field: "Email", from: null, to: "jun@bluebird.example" },
        { field: "Phone", from: null, to: "+63 2 555" },
      ]),
    );
    // Only the creator, owner, granted editors and managers edit.
    await expect(
      update(id, 2, { phone: "0" }, f.teammate.id),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      update(id, 2, { phone: "0" }, f.admin.id),
    ).resolves.toMatchObject({ outcome: "APPLIED" });
  });

  it("sends protected profile edits through approval", async () => {
    const email = await db.boardColumn.findFirstOrThrow({
      where: { boardId: f.contacts, key: "email" },
    });
    await db.boardApprovalPolicy.upsert({
      where: { boardId: f.contacts },
      create: {
        boardId: f.contacts,
        enabled: true,
        requireChanges: true,
        protectedFieldIds: [email.id],
        primaryApproverId: f.admin.id,
      },
      update: {},
    });
    try {
      const id = applied(
        await create(f.contacts, f.member.id, { name: "Leo" }),
      );
      // Unprotected fields still change directly.
      await expect(
        update(id, 1, { phone: "+63 1" }, f.member.id),
      ).resolves.toMatchObject({ outcome: "APPLIED" });
      const pending = await update(
        id,
        2,
        { email: "leo@example.com" },
        f.member.id,
      );
      expect(pending.outcome).toBe("PENDING_APPROVAL");
      const proposal = await db.boardProposal.findFirstOrThrow({
        where: { taskId: id, status: "PENDING" },
      });
      await serial((tx) =>
        decideApprovalInTransaction(
          tx,
          { proposalId: proposal.id, action: "approve" },
          f.admin.id,
        ),
      );
      expect(
        (await db.contactProfile.findUniqueOrThrow({ where: { recordId: id } }))
          .email,
      ).toBe("leo@example.com");
    } finally {
      await db.boardApprovalPolicy.delete({ where: { boardId: f.contacts } });
    }
  });

  it("archives, trashes, restores and purges records with their profile", async () => {
    const id = applied(
      await create(f.companies, f.member.id, { name: "Kalayaan" }),
    );
    await serial((tx) =>
      mutateTaskInTransaction(
        tx,
        "archive",
        { taskId: id, revision: 1 },
        f.member.id,
      ),
    );
    await expect(
      update(id, 2, { phone: "1" }, f.member.id),
    ).rejects.toMatchObject({
      code: "TASK_ARCHIVED",
    });
    const archived = await crmDirectoryFor(
      f.member,
      { type: "COMPANY", archived: true },
      f.workspace.id,
    );
    expect(archived.records.map((record) => record.id)).toContain(id);
    await serial((tx) => deleteRecordInTransaction(tx, { id }, f.admin.id));
    const live = await crmDirectoryFor(
      f.member,
      { type: "COMPANY", archived: true },
      f.workspace.id,
    );
    expect(live.records.map((record) => record.id)).not.toContain(id);
    await serial((tx) => restoreRecordInTransaction(tx, { id }, f.admin.id));
    await serial((tx) => deleteRecordInTransaction(tx, { id }, f.admin.id));
    const selection = eraseSelection(new Date(), { kind: "record", id });
    await eraseBatch(null, selection, "CRM integration proof");
    expect(await db.companyProfile.count({ where: { recordId: id } })).toBe(0);
  });
});

describe("Directory and duplicate suggestions", () => {
  let f: Fixture;
  beforeAll(async () => {
    f = await fixture();
    for (const [name, domain, email] of [
      ["Northwind Trading", "northwind.example", "hello@northwind.example"],
      ["Bluebird Health", "bluebird.example", null],
      ["Acme Labs", null, "sales@acme.example"],
    ])
      await create(f.companies, f.member.id, { name, domain, email });
  });

  it("pages, searches and counts the whole collection", async () => {
    const all = await crmDirectoryFor(
      f.member,
      { type: "COMPANY" },
      f.workspace.id,
    );
    expect(all.records.map((record) => record.name)).toEqual([
      "Acme Labs",
      "Bluebird Health",
      "Northwind Trading",
    ]);
    expect(all).toMatchObject({ total: 3, liveTotal: 3, pageCount: 1 });
    const byDomain = await crmDirectoryFor(
      f.member,
      { type: "COMPANY", q: "bluebird.ex" },
      f.workspace.id,
    );
    expect(byDomain.records.map((record) => record.name)).toEqual([
      "Bluebird Health",
    ]);
    const wildcard = await crmDirectoryFor(
      f.member,
      { type: "COMPANY", q: "%" },
      f.workspace.id,
    );
    expect(wildcard.total).toBe(0);
  });

  it("suggests matches by email, domain and similar name without blocking", async () => {
    const matches = await crmMatchesFor(
      f.member,
      {
        type: "COMPANY",
        name: "Northwind Corp",
        email: "ops@acme.example",
        domain: "BLUEBIRD.example",
      },
      f.workspace.id,
    );
    expect(matches.map((match) => [match.name, match.reason])).toEqual([
      ["Bluebird Health", "DOMAIN"],
      ["Acme Labs", "DOMAIN"],
      ["Northwind Trading", "NAME"],
    ]);
    // Still allowed: suggestions are hints, not a uniqueness rule.
    await expect(
      create(f.companies, f.member.id, { name: "Northwind Trading" }),
    ).resolves.toMatchObject({ outcome: "APPLIED" });
    // Nothing leaks across workspaces.
    const other = await fixture();
    await expect(
      crmMatchesFor(
        other.member,
        { type: "COMPANY", name: "Northwind" },
        other.workspace.id,
      ),
    ).resolves.toEqual([]);
    await expect(
      crmMatchesFor(
        other.member,
        { type: "COMPANY", name: "Northwind" },
        f.workspace.id,
      ),
    ).rejects.toMatchObject({ status: 404 });
  });
});

describe("Database constraints", () => {
  let f: Fixture;
  beforeAll(async () => {
    f = await fixture();
  });
  const insertTask = (boardId: string, id = createRecordId()) =>
    raw(
      `INSERT INTO "Task" ("id","boardId","name","createdById","createKey","createDigest","updatedAt") VALUES ($1,$2,'Raw',$3,$4,'x',now())`,
      id,
      boardId,
      f.admin.id,
      createRecordId(),
    );

  it("requires a profile for every Company or Contact record", async () => {
    await expect(insertTask(f.companies)).rejects.toThrow(/needs its profile/);
    const id = applied(await create(f.contacts, f.member.id));
    await expect(
      raw(`DELETE FROM "ContactProfile" WHERE "recordId" = $1`, id),
    ).rejects.toThrow(/keeps its profile/);
  });

  it("rejects a profile of the wrong type, workspace or record", async () => {
    const contact = applied(await create(f.contacts, f.member.id));
    await expect(
      raw(
        `INSERT INTO "CompanyProfile" ("recordId","workspaceId","updatedAt") VALUES ($1,$2,now())`,
        contact,
        f.workspace.id,
      ),
    ).rejects.toThrow(/COMPANY profile/);
    const other = await fixture();
    await expect(
      raw(
        `UPDATE "ContactProfile" SET "workspaceId" = $1 WHERE "recordId" = $2`,
        other.workspace.id,
        contact,
      ),
    ).rejects.toThrow(/keeps its record and workspace/);
    await expect(
      raw(
        `INSERT INTO "ContactProfile" ("recordId","workspaceId","updatedAt") VALUES ($1,$2,now())`,
        createRecordId(),
        f.workspace.id,
      ),
    ).rejects.toThrow(/foreign key/);
  });
});

describe("Contact–Company links", () => {
  let f: Fixture;
  let ana: string, northwind: string, acme: string;
  const key = () => createRecordId();
  const link = (
    contactId: string,
    companyId: string,
    user = f.member,
    extra: Record<string, unknown> = {},
  ) =>
    serial((tx) =>
      linkCompanyInTransaction(
        tx,
        { contactId, companyId, requestKey: key(), ...extra },
        user,
      ),
    );
  const primary = (
    contactId: string,
    linkId: string | null,
    primaryRevision: number,
    user = f.member,
  ) =>
    serial((tx) =>
      setPrimaryInTransaction(
        tx,
        { contactId, linkId, primaryRevision, requestKey: key() },
        user,
      ),
    );
  const contactRevision = async (id: string) =>
    (await db.task.findUniqueOrThrow({ where: { id } })).revision;
  const insertLink = (contactId: string, companyId: string) =>
    raw(
      `INSERT INTO "ContactCompany" ("id","workspaceId","contactId","companyId","createdById","updatedById","updatedAt") VALUES ($1,$2,$3,$4,'x','x',now())`,
      createRecordId(),
      f.workspace.id,
      contactId,
      companyId,
    );
  beforeAll(async () => {
    f = await fixture();
    ana = applied(await create(f.contacts, f.member.id, { name: "Ana Reyes" }));
    northwind = applied(
      await create(f.companies, f.member.id, { name: "Northwind" }),
    );
    acme = applied(
      await create(f.companies, f.teammate.id, { name: "Acme Labs" }),
    );
  });

  it("links companies with roles, returns existing pairs untouched, and replays", async () => {
    const first = await link(ana, northwind, f.member, {
      role: " Head of operations ",
    });
    expect(first).toMatchObject({ outcome: "LINKED", revision: 1 });
    const again = await link(ana, northwind, f.member, {
      role: "Changed",
      status: "FORMER",
    });
    expect(again).toMatchObject({
      outcome: "ALREADY_LINKED",
      linkId: first.linkId,
    });
    expect(
      await db.contactCompany.findUniqueOrThrow({
        where: { id: first.linkId! },
      }),
    ).toMatchObject({
      role: "Head of operations",
      status: "CURRENT",
      revision: 1,
    });
    // The same request key and payload replays; a changed payload is refused.
    const body = {
      contactId: ana,
      companyId: acme,
      role: "Advisor",
      requestKey: key(),
    };
    const made = await serial((tx) =>
      linkCompanyInTransaction(tx, body, f.member),
    );
    await expect(
      serial((tx) => linkCompanyInTransaction(tx, body, f.member)),
    ).resolves.toEqual(made);
    await expect(
      serial((tx) =>
        linkCompanyInTransaction(tx, { ...body, role: "Buyer" }, f.member),
      ),
    ).rejects.toMatchObject({ code: "RETRY_CHANGED" });
    // Links never change the contact's own revision.
    expect(await contactRevision(ana)).toBe(1);
    expect(await crmLinksFor(f.member, { recordId: ana })).toMatchObject({
      side: "CONTACT",
      total: 2,
      primaryRevision: 0,
      canLink: true,
    });
    const people = await crmLinksFor(f.teammate, { recordId: northwind });
    expect(people.links).toEqual([
      expect.objectContaining({
        visible: true,
        role: "Head of operations",
        canEdit: false,
      }),
    ]);
  });

  it("keeps one primary, with its own revision, under concurrent choices", async () => {
    const rows = await db.contactCompany.findMany({
      where: { contactId: ana },
      orderBy: { id: "asc" },
    });
    const [a, b] = rows;
    const results = await Promise.allSettled([
      primary(ana, a!.id, 0),
      primary(ana, b!.id, 0),
    ]);
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      results.find((result) => result.status === "rejected"),
    ).toMatchObject({
      reason: expect.objectContaining({ code: "PRIMARY_CHANGED" }),
    });
    const chosen = await db.contactCompany.findFirstOrThrow({
      where: { contactId: ana, isPrimary: true },
    });
    const other = chosen.id === a!.id ? b! : a!;
    // Switching moves the primary and its revision; stale tokens conflict.
    await primary(ana, other.id, 1);
    await expect(primary(ana, null, 1)).rejects.toMatchObject({
      code: "PRIMARY_CHANGED",
    });
    expect(
      (await db.contactProfile.findUniqueOrThrow({ where: { recordId: ana } }))
        .primaryRevision,
    ).toBe(2);
    // Marking the primary Former needs an explicit clear and the token.
    const current = await db.contactCompany.findUniqueOrThrow({
      where: { id: other.id },
    });
    const former = (extra: Record<string, unknown>) =>
      serial((tx) =>
        updateLinkInTransaction(
          tx,
          {
            linkId: current.id,
            revision: current.revision,
            requestKey: key(),
            changes: { status: "FORMER" },
            ...extra,
          },
          f.member,
        ),
      );
    await expect(former({})).rejects.toMatchObject({
      code: "PRIMARY_INVOLVED",
    });
    await expect(
      former({ clearPrimary: true, primaryRevision: 1 }),
    ).rejects.toMatchObject({ code: "PRIMARY_CHANGED" });
    expect(
      await former({ clearPrimary: true, primaryRevision: 2 }),
    ).toMatchObject({ primaryRevision: 3, revision: current.revision + 1 });
    expect(
      await db.contactCompany.count({
        where: { contactId: ana, isPrimary: true },
      }),
    ).toBe(0);
    await expect(primary(ana, current.id, 3)).rejects.toMatchObject({
      code: "FORMER_LINK",
    });
    // Direct writes can't make a Former link primary or add a second one.
    await expect(
      raw(
        `UPDATE "ContactCompany" SET "isPrimary" = true WHERE "id" = $1`,
        current.id,
      ),
    ).rejects.toThrow(/primary_current/);
    await db.contactCompany.update({
      where: { id: chosen.id },
      data: { isPrimary: true },
    });
    await db.contactCompany.update({
      where: { id: current.id },
      data: { status: "CURRENT" },
    });
    await expect(
      raw(
        `UPDATE "ContactCompany" SET "isPrimary" = true WHERE "id" = $1`,
        current.id,
      ),
    ).rejects.toThrow(/one_primary/);
  });

  it("edits rows independently and refuses stale ones", async () => {
    const rows = await db.contactCompany.findMany({
      where: { contactId: ana },
      orderBy: { id: "asc" },
    });
    const edit = (row: (typeof rows)[number], role: string) =>
      serial((tx) =>
        updateLinkInTransaction(
          tx,
          {
            linkId: row.id,
            revision: row.revision,
            requestKey: key(),
            changes: { role },
          },
          f.member,
        ),
      );
    await Promise.all([
      edit(rows[0]!, "Operations"),
      edit(rows[1]!, "Board advisor"),
    ]);
    // A Notes edit on the contact is independent too.
    await update(
      ana,
      await contactRevision(ana),
      { description: "Prefers calls." },
      f.member.id,
    );
    await expect(edit(rows[0]!, "Stale")).rejects.toMatchObject({
      code: "LINK_CHANGED",
    });
    expect(await contactRevision(ana)).toBe(2);
  });

  it("requires contact edit access and a visible, live company in the workspace", async () => {
    const other = await fixture();
    const elsewhere = applied(
      await create(other.companies, other.member.id, { name: "Far Away" }),
    );
    const ben = applied(await create(f.contacts, f.member.id, { name: "Ben" }));
    await expect(link(ben, elsewhere)).rejects.toMatchObject({ status: 404 });
    await expect(link(ben, ana)).rejects.toMatchObject({ status: 404 });
    await expect(link(northwind, acme)).rejects.toMatchObject({ status: 404 });
    await expect(link(ben, northwind, f.teammate)).rejects.toMatchObject({
      status: 403,
    });
    await expect(link(ben, northwind, f.outsider)).rejects.toMatchObject({
      status: 404,
    });
    await expect(link(ben, acme, f.admin)).resolves.toMatchObject({
      outcome: "LINKED",
    });
    // Archived ends: no new links, and existing ones are read-only.
    const old = applied(
      await create(f.companies, f.member.id, { name: "Old" }),
    );
    const kept = await link(ben, old);
    const late = applied(
      await create(f.companies, f.member.id, { name: "Late" }),
    );
    for (const id of [old, late])
      await serial((tx) =>
        mutateTaskInTransaction(
          tx,
          "archive",
          { taskId: id, revision: 1 },
          f.member.id,
        ),
      );
    await expect(link(ben, late)).rejects.toMatchObject({
      code: "RECORD_ARCHIVED",
    });
    await expect(
      serial((tx) =>
        removeLinkInTransaction(
          tx,
          { linkId: kept.linkId!, revision: 1, requestKey: key() },
          f.member,
        ),
      ),
    ).rejects.toMatchObject({ code: "RECORD_ARCHIVED" });
    // The database refuses cross-workspace and wrong-type links outright.
    await expect(insertLink(ben, elsewhere)).rejects.toThrow(/foreign key/);
    await expect(insertLink(ben, ana)).rejects.toThrow(/foreign key/);
  });

  it("blocks every link change while the Contacts board needs approvals", async () => {
    const row = await db.contactCompany.findFirstOrThrow({
      where: { contactId: ana },
    });
    const profile = await db.contactProfile.findUniqueOrThrow({
      where: { recordId: ana },
    });
    const extra = applied(
      await create(f.companies, f.member.id, { name: "New Co" }),
    );
    await db.boardApprovalPolicy.create({
      data: {
        boardId: f.contacts,
        enabled: true,
        requireCreation: false,
        requireChanges: true,
      },
    });
    try {
      const blocked = { code: "AFFILIATION_APPROVAL_UNSUPPORTED" };
      await expect(link(ana, extra, f.admin)).rejects.toMatchObject(blocked);
      await expect(
        serial((tx) =>
          updateLinkInTransaction(
            tx,
            {
              linkId: row.id,
              revision: row.revision,
              requestKey: key(),
              changes: { role: "x" },
            },
            f.admin,
          ),
        ),
      ).rejects.toMatchObject(blocked);
      await expect(
        serial((tx) =>
          removeLinkInTransaction(
            tx,
            {
              linkId: row.id,
              revision: row.revision,
              requestKey: key(),
              clearPrimary: true,
              primaryRevision: profile.primaryRevision,
            },
            f.admin,
          ),
        ),
      ).rejects.toMatchObject(blocked);
      await expect(
        primary(ana, null, profile.primaryRevision, f.admin),
      ).rejects.toMatchObject(blocked);
      const page = await crmLinksFor(f.member, { recordId: ana });
      expect(page.canLink).toBe(false);
      expect(page.blocked).toMatch(/approvals/);
      expect(page.links.length).toBeGreaterThan(0);
    } finally {
      await db.boardApprovalPolicy.delete({ where: { boardId: f.contacts } });
    }
  });

  it("caps links at 100, and says so only when every blocker is visible", async () => {
    const cara = applied(
      await create(f.contacts, f.member.id, { name: "Cara" }),
    );
    const ids: string[] = [];
    for (let index = 0; index < 100; index++) {
      const id = applied(
        await create(f.companies, f.member.id, { name: `Cap ${index}` }),
      );
      ids.push(id);
      await link(cara, id);
    }
    const extra = applied(
      await create(f.companies, f.member.id, { name: "One too many" }),
    );
    await expect(link(cara, extra)).rejects.toMatchObject({
      code: "TOO_MANY_LINKS",
    });
    // An existing pair is still a no-op at the cap.
    await expect(link(cara, ids[0]!)).resolves.toMatchObject({
      outcome: "ALREADY_LINKED",
    });
    await serial((tx) =>
      deleteRecordInTransaction(tx, { id: ids[1]! }, f.admin.id),
    );
    await expect(link(cara, extra)).rejects.toMatchObject({
      code: "RESTRICTED_LINKS",
    });
    expect(
      await crmLinksFor(f.member, { recordId: cara, page: 2 }),
    ).toMatchObject({ total: 100, pageCount: 2, canLink: false });
    const first = await crmLinksFor(f.member, { recordId: cara });
    const hidden = first.links.filter((item) => !item.visible);
    expect(hidden).toHaveLength(1);
    expect(JSON.stringify(hidden)).not.toContain(ids[1]!);
  }, 120_000);

  it("keeps links through Trash, hides private ends, and drops them on purge", async () => {
    const dee = applied(await create(f.contacts, f.member.id, { name: "Dee" }));
    const gone = applied(
      await create(f.companies, f.member.id, { name: "Gone Co" }),
    );
    const made = await link(dee, gone);
    await primary(dee, made.linkId, 0);
    await serial((tx) =>
      deleteRecordInTransaction(tx, { id: gone }, f.admin.id),
    );
    expect((await crmLinksFor(f.member, { recordId: dee })).links).toEqual([
      { visible: false, key: "private-0", status: "CURRENT" },
    ]);
    // The hidden primary can't be cleared by accident, or edited by guessing.
    await expect(primary(dee, null, 1)).rejects.toMatchObject({
      code: "RESTRICTED_LINKS",
    });
    await expect(
      serial((tx) =>
        removeLinkInTransaction(
          tx,
          {
            linkId: made.linkId!,
            revision: 2,
            requestKey: key(),
            clearPrimary: true,
            primaryRevision: 1,
          },
          f.member,
        ),
      ),
    ).rejects.toMatchObject({ status: 404 });
    const hiddenRow = await crmDirectoryFor(
      f.member,
      { type: "CONTACT", q: "Dee" },
      f.workspace.id,
    );
    expect(hiddenRow.records[0]?.primaryCompany).toBeNull();
    await serial((tx) =>
      restoreRecordInTransaction(tx, { id: gone }, f.admin.id),
    );
    const back = await crmDirectoryFor(
      f.member,
      { type: "CONTACT", q: "Dee" },
      f.workspace.id,
    );
    expect(back.records[0]?.primaryCompany).toMatchObject({ name: "Gone Co" });
    const companies = await crmDirectoryFor(
      f.member,
      { type: "COMPANY", q: "Gone Co" },
      f.workspace.id,
    );
    expect(companies.records[0]?.currentPeople).toBe(1);
    await serial((tx) =>
      deleteRecordInTransaction(tx, { id: gone }, f.admin.id),
    );
    await eraseBatch(
      null,
      eraseSelection(new Date(), { kind: "record", id: gone }),
      "CRM link proof",
    );
    expect(await db.contactCompany.count({ where: { contactId: dee } })).toBe(
      0,
    );
    expect(
      (await db.contactProfile.findUniqueOrThrow({ where: { recordId: dee } }))
        .primaryRevision,
    ).toBe(2);
    // The card still says what happened, without the company's name.
    const detail = await crmRecordFor(f.member, { recordId: dee });
    expect(detail.activity.map((entry) => entry.action)).toEqual(
      expect.arrayContaining([
        "linked a private company",
        "made a private company the primary company",
      ]),
    );
  });
});
