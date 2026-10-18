import { createHmac, randomBytes, randomInt } from "node:crypto";
import nodemailer from "nodemailer";
import { getDatabase, type DatabaseTransaction } from "@yuzu/database";
import { getAuth } from "@/server/auth";
import {
  mailSchema,
  installationSchema,
  namesSchema,
  ownerSchema,
  ownerEmailSchema,
  smtpSchema,
  verifySchema,
  type SetupStatus,
} from "@/lib/setup-contract";
import {
  configuredOrigin,
  decryptSettings,
  digest,
  encryptSettings,
  matchesSecret,
  SetupError,
} from "./security";

const db = () => getDatabase();
async function serial<T>(
  operation: (tx: DatabaseTransaction) => Promise<T>,
): Promise<T> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await db().$transaction(operation, {
        isolationLevel: "Serializable",
      });
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "P2034"
      ) {
        if (attempt < 2) continue;
        break;
      }
      throw error;
    }
  }
  throw new SetupError(
    409,
    "CONCURRENT_CHANGE",
    "Another setup request changed this step. Refresh and retry.",
  );
}
export async function ownerContext(headers: Headers) {
  const session = await getAuth().api.getSession({ headers });
  const settings = await db().installationSettings.findUnique({
    where: { id: "installation" },
    include: { owner: true },
  });
  if (
    !session ||
    !settings ||
    settings.ownerId !== session.user.id ||
    session.user.role !== "OWNER"
  )
    throw new SetupError(
      403,
      "OWNER_REQUIRED",
      "Sign in as the installation owner to continue.",
    );
  return { session, settings };
}
export async function setupStatus(headers: Headers): Promise<SetupStatus> {
  const settings = await db().installationSettings.findUnique({
    where: { id: "installation" },
    include: { owner: true },
  });
  const claimed = Boolean(
    settings?.ownerId ||
    (await db().setupClaim.findUnique({ where: { id: "owner" } })),
  );
  if (!settings?.ownerId)
    return { phase: "UNCLAIMED", claimed, authorized: false };
  const session = await getAuth().api.getSession({ headers });
  if (
    !session ||
    session.user.id !== settings.ownerId ||
    session.user.role !== "OWNER"
  )
    return { phase: settings.setupState, claimed, authorized: false };
  const smtp = settings.emailConfig
    ? smtpSchema.parse(decryptSettings(settings.emailConfig))
    : undefined;
  const workspace = settings.initialWorkspaceId
    ? await db().workspace.findUnique({
        where: { id: settings.initialWorkspaceId },
        select: { id: true, name: true },
      })
    : null;
  const board = settings.initialBoardId
    ? await db().board.findUnique({
        where: { id: settings.initialBoardId },
        select: { id: true, name: true },
      })
    : null;
  return {
    phase: settings.setupState,
    claimed,
    authorized: true,
    owner: { name: settings.owner!.name, email: settings.owner!.email },
    settings: {
      name: settings.name,
      timezone: settings.timezone,
      defaultDateFormat: settings.defaultDateFormat,
      revision: settings.revision,
      emailConfigured: Boolean(smtp),
      verificationPending: Boolean(
        settings.verificationDigest &&
        settings.verificationExpiresAt &&
        settings.verificationExpiresAt > new Date() &&
        settings.verificationAttempts < 5,
      ),
      emailVerified:
        settings.emailVerifiedRevision === settings.emailConfigRevision &&
        Boolean(smtp),
      smtp: smtp && {
        host: smtp.host,
        port: smtp.port,
        secure: smtp.secure,
        username: smtp.username,
        fromEmail: smtp.fromEmail,
      },
    },
    workspace: workspace ?? undefined,
    board: board ?? undefined,
  };
}

export async function claimOwner(input: unknown) {
  const data = ownerSchema.parse(input);
  const key = process.env.YUZU_SETUP_KEY;
  if (!key || key.length < 32)
    throw new SetupError(
      503,
      "CONFIGURATION_REQUIRED",
      "Generate installation keys before creating the owner.",
    );
  if (!matchesSecret(data.setupKey, key))
    throw new SetupError(
      403,
      "INVALID_SETUP_KEY",
      "The installation key is incorrect.",
    );
  if (
    (
      await db().installationSettings.findUnique({
        where: { id: "installation" },
      })
    )?.ownerId
  )
    throw new SetupError(
      409,
      "ALREADY_CLAIMED",
      "The owner already exists. Sign in to resume setup.",
    );
  const intent = randomBytes(32).toString("base64url");
  const existing = await db().setupClaim.findUnique({ where: { id: "owner" } });
  if (existing && existing.email !== data.email)
    throw new SetupError(
      409,
      "CLAIM_RESERVED",
      "Owner creation is already reserved. Resume with the original owner email.",
    );
  if (existing)
    await db().setupClaim.update({
      where: { id: "owner" },
      data: {
        intentDigest: digest(intent),
        intentExpiresAt: new Date(Date.now() + 300_000),
      },
    });
  else {
    try {
      await db().setupClaim.create({
        data: {
          email: data.email,
          intentDigest: digest(intent),
          intentExpiresAt: new Date(Date.now() + 300_000),
        },
      });
    } catch {
      throw new SetupError(
        409,
        "CLAIM_RESERVED",
        "Another owner request is in progress. Try resuming setup.",
      );
    }
  }
  const user = await db().user.findUnique({
    where: { email: data.email },
    include: { accounts: true },
  });
  // Recover an interrupted auth creation only within the protected, unclaimed bootstrap.
  if (
    user &&
    !user.accounts.some(
      (account) => account.providerId === "credential" && account.password,
    )
  ) {
    await db().user.delete({ where: { id: user.id } });
  }
  const credentialUser = user?.accounts.some(
    (account) => account.providerId === "credential" && account.password,
  );
  const response = credentialUser
    ? await getAuth().api.signInEmail({
        body: { email: data.email, password: data.password },
        asResponse: true,
      })
    : await getAuth().api.signUpEmail({
        body: { name: data.name, email: data.email, password: data.password },
        headers: new Headers({
          "x-yuzu-owner-intent": intent,
          origin: configuredOrigin(),
        }),
        asResponse: true,
      });
  if (!response.ok)
    throw new SetupError(
      422,
      "OWNER_CREATION_FAILED",
      "Owner creation could not finish. Resume with the same email and password.",
    );
  const identity = (await response.clone().json()) as { user: { id: string } };
  await serial(async (tx) => {
    // Singleton settings upsert plus conditional ownership prevents a second winner.
    const settings = await tx.installationSettings.upsert({
      where: { id: "installation" },
      create: {},
      update: {},
    });
    if (settings.ownerId) {
      if (settings.ownerId !== identity.user.id)
        throw new SetupError(
          409,
          "ALREADY_CLAIMED",
          "The installation already has an owner.",
        );
      return;
    }
    await tx.user.update({
      where: { id: identity.user.id },
      data: { role: "OWNER" },
    });
    await tx.installationSettings.update({
      where: { id: "installation" },
      data: { ownerId: identity.user.id, setupState: "OWNER_CREATED" },
    });
    await tx.setupClaim.update({
      where: { id: "owner" },
      data: { intentDigest: "", intentExpiresAt: new Date(0) },
    });
  });
  return response.headers.getSetCookie();
}

function assertIncomplete(state: string) {
  if (state === "READY")
    throw new SetupError(
      409,
      "SETUP_COMPLETE",
      "Installation setup is already complete.",
    );
}
export async function saveInstallation(input: unknown, headers: Headers) {
  const data = installationSchema.parse(input);
  const { settings } = await ownerContext(headers);
  assertIncomplete(settings.setupState);
  const result = await db().installationSettings.updateMany({
    where: {
      id: settings.id,
      revision: data.revision,
      setupState: { not: "READY" },
    },
    data: {
      name: data.name,
      timezone: data.timezone,
      defaultDateFormat: data.defaultDateFormat,
      revision: { increment: 1 },
    },
  });
  if (!result.count)
    throw new SetupError(
      409,
      "STALE_SETTINGS",
      "Settings changed. Refresh before saving.",
    );
}

export async function correctOwnerEmail(input: unknown, headers: Headers) {
  const data = ownerEmailSchema.parse(input);
  const { settings } = await ownerContext(headers);
  assertIncomplete(settings.setupState);
  let proof: Response;
  try {
    proof = await getAuth().api.signInEmail({
      body: { email: settings.owner!.email, password: data.password },
      headers,
      asResponse: true,
    });
  } catch (error) {
    if (typeof error === "object" && error !== null && "statusCode" in error) {
      if (error.statusCode === 429)
        throw new SetupError(
          429,
          "RATE_LIMITED",
          "Too many password checks. Try again later.",
        );
      if (error.statusCode === 401 || error.statusCode === 403)
        throw new SetupError(
          403,
          "PASSWORD_REQUIRED",
          "Enter your current owner password to change the email.",
        );
    }
    throw error;
  }
  if (proof.status === 429)
    throw new SetupError(
      429,
      "RATE_LIMITED",
      "Too many password checks. Try again later.",
    );
  if (!proof.ok)
    throw new SetupError(
      403,
      "PASSWORD_REQUIRED",
      "Enter your current owner password to change the email.",
    );
  try {
    await serial(async (tx) => {
      const current = await tx.installationSettings.findUniqueOrThrow({
        where: { id: settings.id },
      });
      assertIncomplete(current.setupState);
      await tx.user.update({
        where: { id: current.ownerId! },
        data: { email: data.email, emailVerified: false },
      });
      await tx.installationSettings.update({
        where: { id: current.id },
        data: {
          emailVerifiedRevision: null,
          verificationDigest: null,
          verificationExpiresAt: null,
          verificationSentAt: null,
          setupState: "OWNER_CREATED",
          revision: { increment: 1 },
        },
      });
    });
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "P2002"
    )
      throw new SetupError(
        409,
        "EMAIL_UNAVAILABLE",
        "That email cannot be used. Choose another address.",
      );
    throw error;
  }
}

const codeDigest = (code: string, ownerId: string, revision: number) =>
  createHmac("sha256", process.env.SETTINGS_ENCRYPTION_KEY!)
    .update(`${ownerId}:${revision}:${code}`)
    .digest("hex");
export async function sendVerification(input: unknown, headers: Headers) {
  const data = mailSchema.parse(input);
  const { settings } = await ownerContext(headers);
  assertIncomplete(settings.setupState);
  if (
    settings.verificationSentAt &&
    Date.now() - settings.verificationSentAt.getTime() < 60_000
  )
    throw new SetupError(
      429,
      "WAIT_BEFORE_RESENDING",
      "Wait one minute before sending another code.",
    );
  const { revision: expectedRevision, ...configuration } = data;
  const smtp = smtpSchema.parse(configuration);
  if (!smtp.password && smtp.username && settings.emailConfig) {
    const previous = smtpSchema.parse(decryptSettings(settings.emailConfig));
    if (
      previous.host === smtp.host &&
      previous.port === smtp.port &&
      previous.secure === smtp.secure &&
      previous.username === smtp.username
    )
      smtp.password = previous.password;
  }
  const code = randomInt(100000, 1000000).toString();
  const revision = settings.emailConfigRevision + 1;
  const updated = await db().installationSettings.updateMany({
    where: {
      id: settings.id,
      revision: expectedRevision,
      setupState: { not: "READY" },
    },
    data: {
      emailConfig: encryptSettings(smtp),
      emailConfigRevision: revision,
      emailVerifiedRevision: null,
      verificationDigest: codeDigest(code, settings.ownerId!, revision),
      verificationExpiresAt: new Date(Date.now() + 600_000),
      verificationAttempts: 0,
      verificationSentAt: new Date(),
      setupState: "OWNER_CREATED",
      revision: { increment: 1 },
    },
  });
  if (!updated.count)
    throw new SetupError(
      409,
      "STALE_SETTINGS",
      "Settings changed. Refresh before sending.",
    );
  const transport = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    requireTLS:
      !smtp.secure && !["127.0.0.1", "localhost", "::1"].includes(smtp.host),
    auth: smtp.username
      ? { user: smtp.username, pass: smtp.password }
      : undefined,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 15_000,
  });
  try {
    await transport.sendMail({
      from: { name: settings.name, address: smtp.fromEmail },
      to: settings.owner!.email,
      subject: "Verify your Yuzu installation",
      text: `Your verification code is: ${code}\n\nEnter it in Yuzu within 10 minutes. If you did not request setup, ignore this message.`,
    });
  } catch {
    await db().installationSettings.updateMany({
      where: { id: settings.id, emailConfigRevision: revision },
      data: {
        verificationDigest: null,
        verificationExpiresAt: null,
        verificationSentAt: null,
      },
    });
    throw new SetupError(
      422,
      "EMAIL_DELIVERY_FAILED",
      "Email could not be sent. Check the host, port, encryption, sender, and credentials, then retry.",
    );
  } finally {
    transport.close();
  }
}

export async function verifyReceipt(input: unknown, headers: Headers) {
  const { code } = verifySchema.parse(input);
  const { settings } = await ownerContext(headers);
  assertIncomplete(settings.setupState);
  const result = await serial(async (tx) => {
    const current = await tx.installationSettings.findUniqueOrThrow({
      where: { id: settings.id },
    });
    if (
      !current.verificationDigest ||
      !current.verificationExpiresAt ||
      current.verificationExpiresAt < new Date() ||
      current.verificationAttempts >= 5
    )
      return false;
    const valid = matchesSecret(
      codeDigest(code, current.ownerId!, current.emailConfigRevision),
      current.verificationDigest,
    );
    await tx.installationSettings.update({
      where: { id: current.id },
      data: valid
        ? {
            emailVerifiedRevision: current.emailConfigRevision,
            setupState: "EMAIL_VERIFIED",
            verificationDigest: null,
            verificationExpiresAt: null,
            revision: { increment: 1 },
          }
        : { verificationAttempts: { increment: 1 } },
    });
    if (valid)
      await tx.user.update({
        where: { id: current.ownerId! },
        data: { emailVerified: true },
      });
    return valid;
  });
  if (!result)
    throw new SetupError(
      422,
      "INVALID_CODE",
      "The code is incorrect, expired, or has too many attempts. Request a new code if needed.",
    );
}

const columns = [
  { key: "name", name: "Task", type: "TEXT", position: 0 },
  {
    key: "status",
    name: "Status",
    type: "STATUS",
    position: 1,
    config: {
      options: [
        { id: "todo", label: "To do" },
        { id: "in_progress", label: "In progress" },
        { id: "done", label: "Done" },
      ],
    },
  },
  { key: "assignees", name: "Assignees", type: "PEOPLE", position: 2 },
  { key: "priority", name: "Priority", type: "PRIORITY", position: 3 },
  { key: "start_date", name: "Start date", type: "DATE", position: 4 },
  { key: "due_date", name: "Due date", type: "DATE", position: 5 },
  { key: "description", name: "Description", type: "LONG_TEXT", position: 6 },
];
export async function completeSetup(input: unknown, headers: Headers) {
  const data = namesSchema.parse(input);
  const { settings } = await ownerContext(headers);
  if (settings.setupState === "READY") return;
  await db().$transaction(
    async (tx) => {
      // Serialize bootstrap attempts before they can create competing workspaces.
      await tx.$queryRaw`SELECT "id" FROM "InstallationSettings" WHERE "id" = ${settings.id} FOR UPDATE`;
      const current = await tx.installationSettings.findUniqueOrThrow({
        where: { id: settings.id },
      });
      if (current.setupState === "READY") return;
      if (
        !current.emailConfig ||
        current.emailVerifiedRevision !== current.emailConfigRevision ||
        current.setupState !== "EMAIL_VERIFIED"
      )
        throw new SetupError(
          422,
          "EMAIL_VERIFICATION_REQUIRED",
          "Verify email receipt before completing installation.",
        );
      if (current.revision !== data.revision)
        throw new SetupError(
          409,
          "STALE_SETTINGS",
          "Settings changed. Refresh before completing setup.",
        );
      const workspace = await tx.workspace.create({
        data: {
          name: data.workspaceName,
          createdById: current.ownerId!,
          members: { create: { userId: current.ownerId! } },
        },
      });
      const board = await tx.board.create({
        data: {
          name: data.boardName,
          workspaceId: workspace.id,
          createdById: current.ownerId!,
          managers: {
            create: { userId: current.ownerId!, grantedById: current.ownerId! },
          },
          columns: { create: columns },
          groups: { create: { name: "Tasks", position: 0 } },
        },
      });
      await tx.installationSettings.update({
        where: { id: current.id },
        data: {
          initialWorkspaceId: workspace.id,
          initialBoardId: board.id,
          setupState: "READY",
          revision: { increment: 1 },
        },
      });
    },
    { isolationLevel: "ReadCommitted" },
  );
}
