import { test, expect, type Page } from "@playwright/test";
import { createRecordId, getDatabase } from "@yuzu/database";
import { defaultViewConfig } from "../src/lib/saved-view-contract";
import { startTestCsvWorker, stopTestCsvWorker } from "./csv-worker-process";

/**
 * The record compatibility contract (docs/specs/record-contract.md), run on
 * every system record type. A type that fails a row doesn't ship.
 */
process.env.DATABASE_URL = process.env.YUZU_E2E_DATABASE_URL;
const ORIGIN = "http://127.0.0.1:3100";
const MIA_PASSWORD = "mia-member-password-123";

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
const plusDays = (days: number) =>
  new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

async function person(name: string, email: string, password?: string) {
  const id = createRecordId();
  return getDatabase().user.create({
    data: {
      id,
      name,
      email,
      emailVerified: true,
      ...(password
        ? {
            accounts: {
              create: {
                accountId: id,
                providerId: "credential",
                password: await (
                  await import("better-auth/crypto")
                ).hashPassword(password),
              },
            },
          }
        : {}),
    },
  });
}

const types = [
  { type: "TASK", singular: "Task", plural: "Tasks", turnedOff: null },
  {
    type: "DEAL",
    singular: "Deal",
    plural: "Deals",
    turnedOff: { priority: "URGENT" },
  },
] as const;

for (const kind of types)
  test(`the record contract holds for ${kind.plural}`, async ({
    page,
    browser,
    playwright,
  }) => {
    test.setTimeout(150_000);
    const db = getDatabase();
    await ok(
      await post(page, "/api/v1/setup/owner", {
        name: "Team Owner",
        email: "owner@example.test",
        password: "test-owner-password-123",
        confirmPassword: "test-owner-password-123",
        setupKey: process.env.YUZU_E2E_SETUP_KEY,
      }),
    );
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
    const mia = await person("Mia Member", "mia@example.test", MIA_PASSWORD);
    await db.workspaceMember.create({
      data: { workspaceId: workspace.id, userId: mia.id },
    });
    const outsider = await person(
      "Out Sider",
      "out@example.test",
      MIA_PASSWORD,
    );

    const board = (
      await ok(
        await post(page, "/api/v1/boards/create-board", {
          workspaceId: workspace.id,
          name: kind.plural,
          recordType: kind.type,
        }),
      )
    ).id as string;
    const readState = async (context = page, query?: unknown) =>
      context.request.get(
        `/api/v1/boards/state?boardId=${board}${
          query ? `&query=${encodeURIComponent(JSON.stringify(query))}` : ""
        }`,
      );
    const state = async () => (await (await readState()).json()).data;
    const create = (data: Record<string, unknown>) =>
      post(page, "/api/v1/boards/create-task", {
        boardId: board,
        createKey: crypto.randomUUID(),
        ...data,
      });

    // 7. Names: the board speaks the type's language.
    const first = await state();
    expect(first.record).toMatchObject({
      type: kind.type,
      singular: kind.singular,
      plural: kind.plural,
    });

    // 1. Create and update through the one shared path; type rules hold.
    const id = (
      await ok(
        await create({
          name: "Checkout redesign",
          assigneeIds: [mia.id],
          dueDate: plusDays(2),
        }),
      )
    ).taskId as string;
    if (kind.turnedOff) {
      const refused = await create({ name: "Nope", ...kind.turnedOff });
      expect(refused.status()).toBe(422);
      expect((await refused.json()).error.code).toBe("FIELD_TURNED_OFF");
    }
    const revision = (await db.task.findUniqueOrThrow({ where: { id } }))
      .revision;
    await ok(
      await post(page, "/api/v1/boards/update", {
        taskId: id,
        revision,
        requestKey: crypto.randomUUID(),
        changes: { name: "Checkout redesign v2" },
      }),
    );

    // 2. Revisions: a stale save conflicts instead of overwriting.
    const stale = await post(page, "/api/v1/boards/update", {
      taskId: id,
      revision,
      requestKey: crypto.randomUUID(),
      changes: { name: "Overwrite" },
    });
    expect(stale.status()).toBe(409);

    // 11. Activity records the create and the change.
    expect(await db.taskActivity.count({ where: { taskId: id } })).toBe(2);

    // 3. Permissions: someone outside the workspace sees nothing.
    const outsiderContext = await browser.newContext();
    const outsiderPage = await outsiderContext.newPage();
    await ok(
      await post(outsiderPage, "/api/v1/session/sign-in", {
        email: outsider.email,
        password: MIA_PASSWORD,
      }),
    );
    expect((await readState(outsiderPage)).status()).toBe(404);
    await outsiderContext.close();

    // 5–6. Views and filters read the same records.
    const filtered = (
      await (
        await readState(page, {
          config: { ...defaultViewConfig, layout: "table", search: "v2" },
        })
      ).json()
    ).data;
    expect(filtered.tasks.map((task: { id: string }) => task.id)).toEqual([id]);
    const window = {
      config: { ...defaultViewConfig, layout: "calendar" },
      from: plusDays(-3),
      to: plusDays(10),
    };
    const calendar = await (
      await page.request.get(
        `/api/v1/boards/calendar?boardId=${board}&query=${encodeURIComponent(
          JSON.stringify(window),
        )}`,
      )
    ).json();
    expect(JSON.stringify(calendar.data)).toContain(id);
    const timeline = await (
      await page.request.get(
        `/api/v1/boards/timeline?boardId=${board}&query=${encodeURIComponent(
          JSON.stringify(window),
        )}`,
      )
    ).json();
    expect(JSON.stringify(timeline.data)).toContain(id);

    // 4. Approvals apply to the type's fields like any other.
    const status = first.fields.find(
      (field: { key: string }) => field.key === "status",
    );
    await ok(
      await post(page, "/api/v1/approvals/configure", {
        boardId: board,
        version: first.approvalPolicy.version,
        enabled: true,
        requireCreation: false,
        requireChanges: true,
        requireArchive: false,
        protectedFieldIds: [status.id],
        primaryApproverId: owner.id,
        backupApproverId: null,
      }),
    );
    const miaContext = await browser.newContext();
    const miaPage = await miaContext.newPage();
    await ok(
      await post(miaPage, "/api/v1/session/sign-in", {
        email: mia.email,
        password: MIA_PASSWORD,
      }),
    );
    const secondStatus = status.options[1].id as string;
    const requested = await ok(
      await post(miaPage, "/api/v1/boards/update", {
        taskId: id,
        revision: (await db.task.findUniqueOrThrow({ where: { id } })).revision,
        requestKey: crypto.randomUUID(),
        changes: { statusId: secondStatus },
      }),
    );
    expect(requested.outcome).toBe("PENDING_APPROVAL");
    await miaContext.close();
    await ok(
      await post(page, "/api/v1/approvals/configure", {
        boardId: board,
        version: (await state()).approvalPolicy.version,
        enabled: false,
        requireCreation: false,
        requireChanges: false,
        requireArchive: false,
        protectedFieldIds: [],
        primaryApproverId: owner.id,
        backupApproverId: null,
      }),
    );

    // 8. Rules run on the type and follow its fields.
    await ok(
      await post(page, "/api/v1/automations/save", {
        boardId: board,
        name: "Move new ones along",
        trigger: { kind: "task.created" },
        actions: [{ kind: "set.status", value: secondStatus }],
      }),
    );
    const ruled = (await ok(await create({ name: "Support retainer" })))
      .taskId as string;
    await expect
      .poll(
        async () =>
          (await db.task.findUniqueOrThrow({ where: { id: ruled } })).statusId,
        { timeout: 30_000 },
      )
      .toBe(secondStatus);

    // 9. CSV export uses the type's names.
    const csv = await post(page, "/api/v1/boards/export", {
      boardId: board,
      scope: "BOARD",
      includeArchived: false,
    });
    expect(csv.status()).toBe(200);
    const exported = await csv.text();
    expect(exported.split("\r\n")[0]).toContain(
      `"${kind.singular} ID","${kind.singular}"`,
    );
    expect(exported).toContain("Checkout redesign v2");

    // 13. Search labels results with the type.
    const found = await (
      await page.request.get("/api/v1/search/tasks?q=checkout")
    ).json();
    expect(found.data.tasks[0].recordName).toBe(kind.singular);

    // 15. Dashboards count Task boards only.
    const dashboard = await (
      await page.request.get("/api/v1/dashboard")
    ).json();
    expect(dashboard.data.total).toBe(kind.type === "TASK" ? 2 : 0);

    // 10. API tokens act on the type like the app does.
    const token = (
      await ok(
        await post(page, "/api/v1/tokens/create", {
          name: "Contract",
          access: "WRITE",
          expires: "30",
        }),
      )
    ).token as string;
    const api = await playwright.request.newContext({
      baseURL: ORIGIN,
      extraHTTPHeaders: { Authorization: `Bearer ${token}` },
    });
    expect(
      (
        await api.post("/api/v1/boards/create-task", {
          data: {
            boardId: board,
            createKey: crypto.randomUUID(),
            name: "From a script",
          },
        })
      ).status(),
    ).toBe(200);
    await api.dispose();

    // 12. Links: another board links to this type, with a rollup.
    const notes = (
      await ok(
        await post(page, "/api/v1/boards/create-board", {
          workspaceId: workspace.id,
          name: "Notes",
          recordType: "CUSTOM",
          record: { singular: "Note", plural: "Notes" },
        }),
      )
    ).id as string;
    await ok(
      await post(page, "/api/v1/boards/field", {
        boardId: notes,
        name: kind.plural,
        type: "RELATION",
        options: [],
        relation: {
          targetBoardId: board,
          many: true,
          mirrorMany: true,
          mirrorName: "Notes",
        },
      }),
    );
    const link = await db.boardColumn.findFirstOrThrow({
      where: { boardId: notes, type: "RELATION" },
    });
    await ok(
      await post(page, "/api/v1/boards/field", {
        boardId: notes,
        name: "Linked",
        type: "ROLLUP",
        options: [],
        rollup: { relationFieldId: link.id, aggregate: "count" },
      }),
    );
    const rollup = await db.boardColumn.findFirstOrThrow({
      where: { boardId: notes, type: "ROLLUP" },
    });
    const note = (
      await ok(
        await post(page, "/api/v1/boards/create-task", {
          boardId: notes,
          createKey: crypto.randomUUID(),
          name: "Kickoff notes",
          fieldValues: { [link.id]: [id] },
        }),
      )
    ).taskId as string;
    const noteRow = async () =>
      (
        await (
          await page.request.get(`/api/v1/boards/state?boardId=${notes}`)
        ).json()
      ).data.tasks.find((task: { id: string }) => task.id === note);
    expect((await noteRow()).fieldValues[rollup.id]).toBe(1);

    // 17. Deleted records are invisible to everything but Trash.
    await ok(await post(page, "/api/v1/trash/delete-record", { id }));
    expect(
      (await state()).tasks.some((task: { id: string }) => task.id === id),
    ).toBe(false);
    expect(
      (await (await page.request.get("/api/v1/search/tasks?q=checkout")).json())
        .data.total,
    ).toBe(0);
    expect((await noteRow()).fieldValues[link.id] ?? []).toEqual([]);
    expect((await noteRow()).fieldValues[rollup.id]).toBe(0);
    const afterDelete = await post(page, "/api/v1/boards/export", {
      boardId: board,
      scope: "BOARD",
      includeArchived: true,
    });
    expect(await afterDelete.text()).not.toContain("Checkout redesign v2");
    const trash = await (await page.request.get("/api/v1/trash/list")).json();
    expect(
      trash.data.records.map((item: { recordName: string }) => item.recordName),
    ).toEqual([kind.singular]);
  });
