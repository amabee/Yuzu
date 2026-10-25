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
