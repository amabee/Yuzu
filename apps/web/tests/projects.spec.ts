import { test as base, expect, type Page } from "@playwright/test";
import { SMTPServer } from "smtp-server";
import { createRecordId, getDatabase } from "@yuzu/database";
import { encryptSettings } from "../src/server/setup/security";

process.env.DATABASE_URL = process.env.YUZU_E2E_DATABASE_URL;
process.env.SETTINGS_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64url");
const ORIGIN = "http://127.0.0.1:3100";

const test = base.extend<{ mailbox: string[] }>({
  mailbox: async ({}, provide) => {
    const messages: string[] = [];
    const server = new SMTPServer({
      authOptional: true,
      disabledCommands: ["STARTTLS", "AUTH"],
      onData(stream, _session, callback) {
        let body = "";
        stream.on("data", (chunk) => (body += chunk.toString()));
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
  await db.task.deleteMany();
  await db.board.deleteMany();
  await db.project.deleteMany();
  await db.workspaceMember.deleteMany();
  await db.workspace.deleteMany();
  await db.user.deleteMany();
  await db.verification.deleteMany();
  await db.authenticationAttempt.deleteMany();
});

/** Owner (admin), two workspace members, one standalone board. */
async function team(page: Page) {
  expect(
    (
      await page.request.post("/api/v1/setup/owner", {
        headers: { origin: ORIGIN },
        data: {
          name: "Team Owner",
          email: "owner@example.test",
          password: "test-owner-password-123",
          confirmPassword: "test-owner-password-123",
          setupKey: process.env.YUZU_E2E_SETUP_KEY,
        },
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
  const standalone = await db.board.create({
    data: {
      name: "Team requests",
      workspaceId: workspace.id,
      createdById: owner.id,
    },
  });
  await db.installationSettings.update({
    where: { id: "installation" },
    data: {
      setupState: "READY",
      initialWorkspaceId: workspace.id,
      initialBoardId: standalone.id,
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
  const person = async (name: string, email: string) => {
    const id = createRecordId();
    const user = await db.user.create({
      data: {
        id,
        name,
        email,
        emailVerified: true,
        accounts: {
          create: {
            accountId: id,
            providerId: "credential",
            password: await (
              await import("better-auth/crypto")
            ).hashPassword(`${name.toLowerCase()}-password-123`),
          },
        },
      },
    });
    await db.workspaceMember.create({
      data: { workspaceId: workspace.id, userId: user.id },
    });
    return user;
  };
  const mia = await person("Mia", "mia@example.test");
  const lee = await person("Lee", "lee@example.test");
  return { owner, mia, lee, workspace, standalone };
}

async function signIn(
  browser: import("@playwright/test").Browser,
  email: string,
  password: string,
) {
  const context = await browser.newContext({ baseURL: ORIGIN });
  const page = await context.newPage();
  expect(
    (
      await page.request.post("/api/v1/session/sign-in", {
        headers: { origin: ORIGIN },
        data: { email, password },
      })
    ).status(),
  ).toBe(200);
  return { context, page };
}
const post = (page: Page, path: string, data: unknown) =>
  page.request.post(path, { headers: { origin: ORIGIN }, data });
const listNames = async (page: Page, workspaceId: string) =>
  (
    (await (
      await page.request.get(`/api/v1/projects/list?workspaceId=${workspaceId}`)
    ).json()) as { data: { projects: { name: string }[] } }
  ).data.projects.map((project) => project.name);
const boardStatus = async (page: Page, boardId: string) =>
  (await page.request.get(`/api/v1/boards/state?boardId=${boardId}`)).status();

test("private projects hide their boards, tasks and names from everyone outside them", async ({
  page,
  browser,
  mailbox,
}) => {
  const { mia, lee, workspace } = await team(page);
  const miaSession = await signIn(browser, mia.email, "mia-password-123");
  const leeSession = await signIn(browser, lee.email, "lee-password-123");
  try {
    const created = await post(miaSession.page, "/api/v1/projects/create", {
      workspaceId: workspace.id,
      name: "Secret launch",
      color: "rose",
      visibility: "PRIVATE",
    });
    expect(created.status()).toBe(200);
    const projectId = (await created.json()).data.id as string;
    const boardMade = await post(
      miaSession.page,
      "/api/v1/boards/create-board",
      {
        projectId,
        name: "Launch plan",
      },
    );
    expect(boardMade.status()).toBe(200);
    const boardId = (await boardMade.json()).data.id as string;
    const db = getDatabase();
    const taskMade = await post(miaSession.page, "/api/v1/boards/create-task", {
      boardId,
      createKey: crypto.randomUUID(),
      name: "Unannounced pricing",
    });
    expect(taskMade.status()).toBe(200);

    // The creator manages it and sees everything.
    expect(await listNames(miaSession.page, workspace.id)).toContain(
      "Secret launch",
    );
    expect(await boardStatus(miaSession.page, boardId)).toBe(200);

    // A workspace member and the owner (an admin) see nothing: not the name,
    // not the board, not its tasks in search, not the board page.
    for (const viewer of [leeSession.page, page]) {
      expect(await listNames(viewer, workspace.id)).not.toContain(
        "Secret launch",
      );
      expect(await boardStatus(viewer, boardId)).toBe(404);
      const search = await viewer.request.get(
        "/api/v1/search/tasks?q=Unannounced&archived=false",
      );
      expect(await search.text()).not.toContain("Unannounced pricing");
      const overview = await viewer.request.get(
        `/api/v1/dashboard?workspaceId=${workspace.id}`,
      );
      expect(await overview.text()).not.toContain("Launch plan");
      await viewer.goto(`/boards/${boardId}`);
      await expect(
        viewer.getByRole("heading", { name: "Launch plan" }),
      ).toHaveCount(0);
      await viewer.goto("/");
      await expect(viewer.getByText("Launch plan")).toHaveCount(0);
    }

    // Adding Lee grants access; removing him takes it away immediately.
    expect(
      (
        await post(miaSession.page, "/api/v1/projects/member", {
          action: "add",
          projectId,
          userId: lee.id,
          role: "MEMBER",
        })
      ).status(),
    ).toBe(200);
    expect(await boardStatus(leeSession.page, boardId)).toBe(200);
    expect(await listNames(leeSession.page, workspace.id)).toContain(
      "Secret launch",
    );
    expect(
      (
        await post(miaSession.page, "/api/v1/projects/member", {
          action: "remove",
          projectId,
          userId: lee.id,
        })
      ).status(),
    ).toBe(200);
    expect(await boardStatus(leeSession.page, boardId)).toBe(404);

    // The last manager cannot step down.
    const demote = await post(miaSession.page, "/api/v1/projects/member", {
      action: "role",
      projectId,
      userId: mia.id,
      role: "MEMBER",
    });
    expect(demote.status()).toBe(409);

    // Admins see that it exists in the directory (name and managers only)...
    const directory = await page.request.get("/api/v1/projects/directory");
    const listing = await directory.text();
    expect(listing).toContain("Secret launch");
    expect(listing).not.toContain("Launch plan");
    // ...and can only get in through deliberate, audited, announced recovery.
    expect(
      (
        await post(page, "/api/v1/projects/recover", {
          projectId,
          confirmName: "secret launch",
        })
      ).status(),
    ).toBe(422);
    expect(
      (
        await post(page, "/api/v1/projects/recover", {
          projectId,
          confirmName: "Secret launch",
        })
      ).status(),
    ).toBe(200);
    expect(await boardStatus(page, boardId)).toBe(200);
    expect(
      await db.accessEvent.count({
        where: { action: "PROJECT_ACCESS_RECOVERED" },
      }),
    ).toBe(1);
    await expect
      .poll(() => mailbox.join("\n"))
      .toContain("recovered access to Secret launch");
  } finally {
    await miaSession.context.close();
    await leeSession.context.close();
  }
});

test("public projects, standalone boards, moving and archiving follow project roles", async ({
  page,
  browser,
}) => {
  const { mia, workspace, standalone } = await team(page);
  const miaSession = await signIn(browser, mia.email, "mia-password-123");
  try {
    const created = await post(page, "/api/v1/projects/create", {
      workspaceId: workspace.id,
      name: "Yuzu 1.0",
      color: "teal",
      visibility: "PUBLIC",
    });
    expect(created.status()).toBe(200);
    const projectId = (await created.json()).data.id as string;
    const duplicate = await post(page, "/api/v1/projects/create", {
      workspaceId: workspace.id,
      name: "Yuzu 1.0",
      color: "teal",
      visibility: "PUBLIC",
    });
    expect(duplicate.status()).toBe(409);

    // Everyone in the workspace sees a public project and its boards.
    expect(await listNames(miaSession.page, workspace.id)).toContain(
      "Yuzu 1.0",
    );

    // Only its managers (or admins) add boards to it.
    expect(
      (
        await post(miaSession.page, "/api/v1/boards/create-board", {
          projectId,
          name: "Not allowed",
        })
      ).status(),
    ).toBe(403);

    // The standalone board moves into the project, keeps its id, stays visible.
    expect(
      (
        await post(page, "/api/v1/projects/move-board", {
          boardId: standalone.id,
          projectId,
        })
      ).status(),
    ).toBe(200);
    const db = getDatabase();
    expect(
      (await db.board.findUniqueOrThrow({ where: { id: standalone.id } }))
        .projectId,
    ).toBe(projectId);
    expect(await boardStatus(miaSession.page, standalone.id)).toBe(200);
    expect(
      await db.boardEvent.count({
        where: { boardId: standalone.id, action: "Moved board" },
      }),
    ).toBe(1);

    // Stale edits are refused.
    const stale = await post(page, "/api/v1/projects/update", {
      projectId,
      revision: 99,
      name: "Renamed",
    });
    expect(stale.status()).toBe(409);

    // Archiving makes its boards read-only but still readable; restoring undoes it.
    expect(
      (await post(page, "/api/v1/projects/archive", { projectId })).status(),
    ).toBe(200);
    expect(await boardStatus(page, standalone.id)).toBe(200);
    const blocked = await post(page, "/api/v1/boards/group", {
      boardId: standalone.id,
      name: "New group",
    });
    expect(blocked.status()).toBe(403);
    expect((await blocked.json()).error.code).toBe("PROJECT_ARCHIVED");
    expect(await listNames(page, workspace.id)).not.toContain("Yuzu 1.0");
    expect(
      (await post(page, "/api/v1/projects/restore", { projectId })).status(),
    ).toBe(200);
    expect(
      (
        await post(page, "/api/v1/boards/group", {
          boardId: standalone.id,
          name: "New group",
        })
      ).status(),
    ).toBe(200);

    // And back out to standalone.
    expect(
      (
        await post(page, "/api/v1/projects/move-board", {
          boardId: standalone.id,
          projectId: null,
        })
      ).status(),
    ).toBe(200);
    expect(
      (await db.board.findUniqueOrThrow({ where: { id: standalone.id } }))
        .projectId,
    ).toBeNull();
  } finally {
    await miaSession.context.close();
  }
});

test("an outsider invited to a project sees that project and nothing else", async ({
  page,
  browser,
  mailbox,
}) => {
  const { mia, workspace, standalone } = await team(page);
  const miaSession = await signIn(browser, mia.email, "mia-password-123");
  try {
    const created = await post(miaSession.page, "/api/v1/projects/create", {
      workspaceId: workspace.id,
      name: "Agency work",
      color: "citrus",
      visibility: "PRIVATE",
    });
    const projectId = (await created.json()).data.id as string;
    const boardId = (
      await (
        await post(miaSession.page, "/api/v1/boards/create-board", {
          projectId,
          name: "Client deliverables",
        })
      ).json()
    ).data.id as string;
    await post(page, "/api/v1/projects/create", {
      workspaceId: workspace.id,
      name: "Internal only",
      color: "slate",
      visibility: "PUBLIC",
    });

    expect(
      (
        await post(miaSession.page, "/api/v1/projects/invite", {
          projectId,
          email: "Client@Example.test",
          role: "MEMBER",
        })
      ).status(),
    ).toBe(200);
    await expect.poll(() => mailbox.length).toBeGreaterThan(0);
    const token = mailbox
      .at(-1)!
      .replace(/=\r?\n/g, "")
      .match(/\/invite#([A-Za-z0-9_-]{43})/)?.[1];
    expect(token).toBeTruthy();

    const outsider = await browser.newContext({ baseURL: ORIGIN });
    const outsiderPage = await outsider.newPage();
    try {
      const preview = await post(outsiderPage, "/api/v1/team/preview", {
        token,
      });
      expect((await preview.json()).data.workspaceName).toBe("Agency work");
      expect(
        (
          await post(outsiderPage, "/api/v1/team/accept", {
            token,
            name: "Client",
            password: "client-password-123",
          })
        ).status(),
      ).toBe(200);
      const member = await getDatabase().projectMember.findFirstOrThrow({
        where: { projectId, user: { email: "client@example.test" } },
      });
      expect(member.projectOnly).toBe(true);
      expect(
        (
          await post(outsiderPage, "/api/v1/session/sign-in", {
            email: "client@example.test",
            password: "client-password-123",
          })
        ).status(),
      ).toBe(200);

      expect(await boardStatus(outsiderPage, boardId)).toBe(200);
      // No standalone boards, no public projects: project-only means project only.
      expect(await boardStatus(outsiderPage, standalone.id)).toBe(404);
      expect(await listNames(outsiderPage, workspace.id)).toEqual([
        "Agency work",
      ]);
      // They can't start projects in a workspace they don't belong to.
      expect(
        (
          await post(outsiderPage, "/api/v1/projects/create", {
            workspaceId: workspace.id,
            name: "Mine",
            color: "blue",
            visibility: "PUBLIC",
          })
        ).status(),
      ).toBe(404);
      // A used link can't be replayed.
      expect(
        (await post(outsiderPage, "/api/v1/team/preview", { token })).status(),
      ).toBe(410);
    } finally {
      await outsider.close();
    }
  } finally {
    await miaSession.context.close();
  }
});

test("projects UI: create, add boards and people, move a board, archive from the sidebar", async ({
  page,
  browser,
}) => {
  test.setTimeout(120_000);
  const shots = process.env.YUZU_E2E_SHOTS;
  const { mia, lee } = await team(page);
  const miaSession = await signIn(browser, mia.email, "mia-password-123");
  const leeSession = await signIn(browser, lee.email, "lee-password-123");
  const mp = miaSession.page;
  try {
    await mp.setViewportSize({ width: 1280, height: 800 });
    await mp.goto("/");
    const projectsNav = mp.getByRole("navigation", { name: "Projects" });
    await expect(projectsNav.getByText("No projects yet.")).toBeVisible();
    // Standalone boards keep their own group.
    await expect(
      mp
        .getByRole("navigation", { name: "Workspace boards" })
        .getByRole("link", { name: "Team requests" }),
    ).toBeVisible();

    // Create a private project from the sidebar, keyboard only.
    await mp.getByRole("button", { name: "New project" }).focus();
    await mp.keyboard.press("Enter");
    const sheet = mp.getByRole("dialog", { name: "Create project" });
    await sheet.getByLabel("Project name").fill("Yuzu 1.0");
    await sheet.getByRole("radio", { name: "Citrus" }).click();
    await sheet.getByRole("radio", { name: /Private/ }).check();
    if (shots) await mp.screenshot({ path: `${shots}/create-project.png` });
    await sheet.getByRole("button", { name: "Create project" }).click();
    await expect(mp).toHaveURL(/\/projects\/[0-9a-f-]+$/);
    const projectUrl = mp.url();
    await expect(mp.getByRole("heading", { name: "Yuzu 1.0" })).toBeVisible();
    await expect(mp.getByText("Private, 1 member")).toBeVisible();
    await expect(mp.getByText("No boards in this project yet")).toBeVisible();
    await expect(
      projectsNav.getByRole("link", { name: /Yuzu 1\.0/ }),
    ).toBeVisible();
    await expect(projectsNav.getByLabel("Private project")).toBeVisible();

    // New board inside the project, with a Project › Board breadcrumb.
    await mp.getByRole("button", { name: "New board" }).click();
    await mp.getByLabel("Board name").fill("Q4 Launch");
    await mp
      .getByRole("dialog")
      .getByRole("button", { name: "Create board" })
      .click();
    await expect(mp).toHaveURL(/\/boards\//);
    const crumbs = mp.getByRole("navigation", { name: "Breadcrumb" });
    await expect(crumbs.getByRole("link", { name: "Yuzu 1.0" })).toBeVisible();
    await expect(crumbs.getByText("Q4 Launch")).toBeVisible();
    await expect(
      projectsNav.getByRole("link", { name: "Q4 Launch" }),
    ).toBeVisible();

    // Lee can't see it yet.
    await leeSession.page.goto("/");
    await expect(
      leeSession.page
        .getByRole("navigation", { name: "Projects" })
        .getByText("Yuzu 1.0"),
    ).toHaveCount(0);

    // Add Lee from the members sheet.
    await mp.goto(projectUrl);
    await mp.getByRole("button", { name: "Members" }).click();
    const members = mp.getByRole("dialog", { name: "Members" });
    await members
      .getByLabel("Person to add")
      .selectOption({ label: "Lee (lee@example.test)" });
    await members.getByRole("button", { name: "Add to project" }).click();
    await expect(
      members
        .getByRole("list", { name: "Project members" })
        .getByText("Lee", { exact: true }),
    ).toBeVisible();
    if (shots) await mp.screenshot({ path: `${shots}/members.png` });
    await mp.keyboard.press("Escape");
    await expect(mp).not.toHaveURL(/panel=/);
    await leeSession.page.reload();
    await expect(
      leeSession.page
        .getByRole("navigation", { name: "Projects" })
        .getByRole("link", { name: /Yuzu 1\.0/ }),
    ).toBeVisible();

    // Move the standalone board in; the private warning shows first.
    await mp.goto("/");
    await mp
      .getByRole("navigation", { name: "Workspace boards" })
      .getByRole("link", { name: "Team requests" })
      .click();
    await expect(
      mp.getByRole("heading", { name: "Team requests" }),
    ).toBeVisible();
    // Mia isn't a manager of the standalone board, so she can't move it.
    await expect(mp.getByRole("button", { name: "Move to…" })).toHaveCount(0);
    await page.goto("/");
    await page
      .getByRole("navigation", { name: "Workspace boards" })
      .getByRole("link", { name: "Team requests" })
      .click();
    await expect(page.getByRole("button", { name: "Move to…" })).toHaveCount(0);

    // Mia moves her project board out to standalone and back.
    await mp.goto(projectUrl);
    await mp.getByRole("button", { name: "Move to…" }).click();
    const move = mp.getByRole("dialog", { name: "Move Q4 Launch" });
    await move.getByRole("radio", { name: /No project/ }).check();
    await move.getByRole("button", { name: "Move board" }).click();
    await expect(mp.getByText("No boards in this project yet")).toBeVisible();
    await expect(
      mp
        .getByRole("navigation", { name: "Workspace boards" })
        .getByRole("link", { name: "Q4 Launch" }),
    ).toBeVisible();
    await mp
      .getByRole("navigation", { name: "Workspace boards" })
      .getByRole("link", { name: "Q4 Launch" })
      .click();
    await mp.getByRole("button", { name: "Move to…" }).click();
    const back = mp.getByRole("dialog", { name: "Move Q4 Launch" });
    await back.getByRole("radio", { name: /Yuzu 1\.0/ }).check();
    await expect(back.getByText(/is private\. Only its members/)).toBeVisible();
    await back.getByRole("button", { name: "Move board" }).click();
    await expect(crumbs.getByRole("link", { name: "Yuzu 1.0" })).toBeVisible();
    await mp.goto(projectUrl);
    await expect(
      mp.getByRole("progressbar", { name: "Q4 Launch progress" }),
    ).toBeVisible();
    if (shots) await mp.screenshot({ path: `${shots}/project-page.png` });

    // Rename via the edit panel opened from the sidebar menu.
    await projectsNav.getByRole("button", { name: "Yuzu 1.0 options" }).click();
    await mp.getByRole("menuitem", { name: /Rename/ }).click();
    const edit = mp.getByRole("dialog", { name: "Edit project" });
    await edit.getByLabel("Project name").fill("Yuzu 1.1");
    await edit.getByRole("button", { name: "Save changes" }).click();
    await expect(mp.getByRole("heading", { name: "Yuzu 1.1" })).toBeVisible();

    // Archive from the sidebar menu; restore from the toast.
    await projectsNav.getByRole("button", { name: "Yuzu 1.1 options" }).click();
    await mp.getByRole("menuitem", { name: "Archive" }).click();
    await mp.getByRole("button", { name: "Archive project" }).click();
    await expect(mp).toHaveURL(/\/$/);
    await expect(projectsNav.getByText("Yuzu 1.1")).toHaveCount(0);
    await mp.getByRole("button", { name: "Restore" }).click();
    await expect(
      projectsNav.getByRole("link", { name: /Yuzu 1\.1/ }),
    ).toBeVisible();
    if (shots) await mp.screenshot({ path: `${shots}/sidebar.png` });
  } finally {
    await miaSession.context.close();
    await leeSession.context.close();
  }
});
