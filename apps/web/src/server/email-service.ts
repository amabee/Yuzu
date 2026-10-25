import { createRecordId, getDatabase } from "@yuzu/database";
import {
  emailKinds,
  emailPreferencesSchema,
  HOURLY_EMAIL_LIMIT,
  type EmailSettings,
} from "@/lib/email-contract";
import {
  digestEmail,
  instantEmail,
  ruleEmail,
  tokenExpiryEmail,
  type DigestItem,
} from "@/lib/email-templates";
import { latestOccurrence } from "@/lib/automation-schedule";
import { fieldOptions } from "@/lib/board-contract";
import { emailReady, sendVerifiedEmail } from "./email";
import {
  deliveries,
  readUnsubscribeToken,
  unsubscribeToken,
} from "./email-queue";
import { visibility } from "./notification-service";
import { eraseExpiredTrash } from "./trash-service";
import { requireIdentity } from "./team-access";
import { configuredOrigin, SetupError } from "./setup/security";

const db = () => getDatabase();
const RETRY_DELAYS = [60_000, 5 * 60_000, 15 * 60_000];

// ---------- Settings ----------

export async function emailSettings(headers: Headers): Promise<EmailSettings> {
  const { user, settings } = await requireIdentity(headers);
  const [saved, person] = await Promise.all([
    db().notificationPreference.findMany({ where: { userId: user.id } }),
    db().user.findUniqueOrThrow({
      where: { id: user.id },
      select: { digestTime: true },
    }),
  ]);
  return {
    preferences: emailKinds.map((item) => ({
      kind: item.kind,
      label: item.label,
      hint: item.hint,
      delivery:
        saved.find((row) => row.kind === item.kind)?.delivery ?? item.delivery,
    })),
    digestTime: person.digestTime,
    timezone: settings?.timezone ?? "UTC",
    emailReady: emailReady(settings ?? null),
  };
}

export async function saveEmailSettings(input: unknown, headers: Headers) {
  const { user } = await requireIdentity(headers);
  const body = emailPreferencesSchema.parse(input);
  await db().$transaction([
    ...body.preferences.map((item) =>
      db().notificationPreference.upsert({
        where: { userId_kind: { userId: user.id, kind: item.kind } },
        create: { userId: user.id, kind: item.kind, delivery: item.delivery },
        update: { delivery: item.delivery },
      }),
    ),
    db().user.update({
      where: { id: user.id },
      data: { digestTime: body.digestTime },
    }),
  ]);
  return emailSettings(headers);
}

/** One click from an email: turn that kind (or the digest) off. */
export async function unsubscribe(token: string) {
  const parsed = readUnsubscribeToken(token);
  if (!parsed)
    throw new SetupError(
      400,
      "INVALID_LINK",
      "This unsubscribe link isn't valid. Change email settings in Yuzu instead.",
    );
  if (parsed.kind === "DIGEST")
    await db().user.update({
      where: { id: parsed.userId },
      data: { digestTime: null },
    });
  else
    await db().notificationPreference.upsert({
      where: {
        userId_kind: { userId: parsed.userId, kind: parsed.kind as never },
      },
      create: {
        userId: parsed.userId,
        kind: parsed.kind as never,
        delivery: "OFF",
      },
      update: { delivery: "OFF" },
    });
  return {
    label:
      parsed.kind === "DIGEST"
        ? "the daily digest"
        : `${emailKinds.find((item) => item.kind === parsed.kind)?.label.toLowerCase() ?? "these"} emails`,
  };
}

function links(userId: string, kind: string, reason: string, label: string) {
  const origin = configuredOrigin();
  const token = unsubscribeToken(userId, kind);
  return {
    origin,
    settingsUrl: `${origin}/settings/notifications`,
    unsubscribeUrl: `${origin}/api/v1/email/unsubscribe?t=${encodeURIComponent(token)}`,
    reason,
    unsubscribeLabel: label,
  };
}
const kindLabel = (kind: string) =>
  emailKinds.find((item) => item.kind === kind)?.label.toLowerCase() ??
  "notifications";

// ---------- Rule emails ----------

/** Queues a rule's "Send an email" step for people who haven't turned rule emails off. */
export async function queueRuleEmails(
  tx: Parameters<Parameters<ReturnType<typeof db>["$transaction"]>[0]>[0],
  input: {
    userIds: string[];
    subject: string;
    message: string;
    ruleName: string;
    boardId: string;
    task: { id: string; name: string } | null;
    appName: string;
  },
) {
  if (!input.userIds.length) return 0;
  const wants = await deliveries(tx, input.userIds, "AUTOMATION");
  const to = input.userIds.filter((id) => wants.get(id) !== "OFF");
  const origin = configuredOrigin();
  const taskUrl = input.task
    ? `${origin}/boards/${input.boardId}?task=${input.task.id}`
    : `${origin}/boards/${input.boardId}`;
  if (to.length)
    await tx.emailMessage.createMany({
      data: to.map((userId) => {
        const email = ruleEmail(
          {
            appName: input.appName,
            subject: input.subject,
            message: input.message,
            ruleName: input.ruleName,
            taskName: input.task?.name ?? null,
            taskUrl,
          },
          links(
            userId,
            "AUTOMATION",
            "A board rule sent you this email.",
            "Unsubscribe from rule emails",
          ),
        );
        return {
          id: createRecordId(),
          userId,
          purpose: "rule",
          subject: email.subject,
          html: email.html,
          text: email.text,
        };
      }),
    });
  return to.length;
}

// ---------- Sending ----------

async function renderInstant(notificationId: string, userId: string) {
  const user = await db().user.findUniqueOrThrow({ where: { id: userId } });
  const note = await db().notification.findFirst({
    where: { id: notificationId, ...visibility(user) },
    include: {
      actor: { select: { name: true } },
      board: {
        select: {
          id: true,
          name: true,
          project: { select: { name: true } },
          columns: { where: { key: { in: ["status", "priority"] } } },
        },
      },
      task: {
        select: {
          id: true,
          name: true,
          statusId: true,
          priority: true,
          dueDate: true,
          parent: { select: { name: true } },
        },
      },
      proposal: { select: { changes: true } },
    },
  });
  if (!note || note.readAt) return null;
  const settings = await db().installationSettings.findUnique({
    where: { id: "installation" },
  });
  const origin = configuredOrigin();
  const option = (key: string, id: string | null | undefined) =>
    fieldOptions(
      note.board.columns.find((column) => column.key === key)?.config,
    ).find((item) => item.id === id)?.label;
  const taskName =
    (note.task
      ? `${note.task.name}${note.task.parent ? ` · Subitem of ${note.task.parent.name}` : ""}`
      : undefined) ??
    String(
      (note.proposal?.changes as Record<string, unknown> | undefined)?.name ??
        "Task request",
    );
  return instantEmail(
    {
      appName: settings?.name ?? "Yuzu",
      kind: note.kind,
      actorName: note.actor.name,
      message: note.message,
      taskName,
      boardName: note.board.name,
      projectName: note.board.project?.name ?? null,
      taskUrl: note.task
        ? `${origin}/boards/${note.board.id}?task=${note.task.id}`
        : `${origin}/approvals`,
      details: note.task
        ? {
            status: option("status", note.task.statusId),
            due: note.task.dueDate
              ? new Intl.DateTimeFormat("en", {
                  month: "short",
                  day: "numeric",
                  timeZone: "UTC",
                }).format(note.task.dueDate)
              : undefined,
            priority:
              option("priority", note.task.priority) ??
              note.task.priority.charAt(0) +
                note.task.priority.slice(1).toLowerCase(),
          }
        : undefined,
    },
    links(
      userId,
      note.kind,
      `You get these instantly for ${kindLabel(note.kind)}.`,
      `Unsubscribe from ${kindLabel(note.kind)} emails`,
    ),
  );
}

/** Sends due emails once each. Returns how many it handled. */
export async function processEmailQueue(limit = 20) {
  const due = await db().emailMessage.findMany({
    where: { status: "QUEUED", sendAfter: { lte: new Date() } },
    include: { user: { select: { email: true } } },
    orderBy: { sendAfter: "asc" },
    take: limit,
  });
  if (!due.length) return 0;
  const settings = await db().installationSettings.findUnique({
    where: { id: "installation" },
  });
  for (const message of due) {
    const skip = (error: string) =>
      db().emailMessage.update({
        where: { id: message.id },
        data: { status: "SKIPPED", error },
      });
    if (!emailReady(settings ?? null)) {
      await skip("Email isn't set up for this installation.");
      continue;
    }
    let email = message.subject
      ? { subject: message.subject, html: message.html!, text: message.text! }
      : null;
    if (message.purpose === "instant") {
      // Read or replaced in the app meanwhile: nothing to send.
      email = await renderInstant(message.notificationId!, message.userId);
      if (!email) {
        await skip("Already read in Yuzu.");
        continue;
      }
      const lastHour = await db().emailMessage.count({
        where: {
          userId: message.userId,
          status: "SENT",
          sentAt: { gte: new Date(Date.now() - 3_600_000) },
        },
      });
      // Too many in an hour: the notification waits for the digest.
      if (lastHour >= HOURLY_EMAIL_LIMIT) {
        await skip("Hourly limit reached; it will be in the daily digest.");
        continue;
      }
    }
    if (!email) {
      await skip("Nothing to send.");
      continue;
    }
    const unsubscribe = email.html
      .match(/href="([^"]*unsubscribe[^"]*)"/)?.[1]
      ?.replace(/&amp;/g, "&");
    try {
      await sendVerifiedEmail(
        settings!,
        message.user.email,
        email.subject,
        email.text,
        {
          html: email.html,
          headers: unsubscribe
            ? {
                "List-Unsubscribe": `<${unsubscribe}>`,
                "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
              }
            : {},
        },
      );
      await db().emailMessage.update({
        where: { id: message.id },
        data: {
          status: "SENT",
          sentAt: new Date(),
          attempts: { increment: 1 },
          subject: email.subject,
        },
      });
    } catch (error) {
      const attempts = message.attempts + 1;
      const retry = attempts <= RETRY_DELAYS.length;
      await db().emailMessage.update({
        where: { id: message.id },
        data: {
          attempts,
          status: retry ? "QUEUED" : "FAILED",
          error:
            error instanceof SetupError
              ? error.message
              : "The mail server didn't accept the email.",
          ...(retry
            ? { sendAfter: new Date(Date.now() + RETRY_DELAYS[attempts - 1]!) }
            : {}),
        },
      });
    }
  }
  return due.length;
}

// ---------- Daily digest ----------

const greetingFor = (hour: number) =>
  hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

/**
 * Queues each person's digest once a day at their time, listing unread
 * notifications of the kinds they chose to get daily. Empty days send nothing.
 */
export async function scanDigests(now = new Date()) {
  const settings = await db().installationSettings.findUnique({
    where: { id: "installation" },
  });
  if (settings?.setupState !== "READY") return 0;
  const zone = settings.timezone ?? "UTC";
  const people = await db().user.findMany({
    where: { digestTime: { not: null }, deactivatedAt: null },
    select: {
      id: true,
      name: true,
      role: true,
      digestTime: true,
      lastDigestAt: true,
      createdAt: true,
    },
  });
  let queued = 0;
  for (const person of people) {
    const at = latestOccurrence(
      { every: "day", time: person.digestTime! },
      now,
      zone,
    );
    if (!at || (person.lastDigestAt && at <= person.lastDigestAt)) continue;
    // Claim this day's digest so a second worker doesn't send it too.
    const claimed = await db().user.updateMany({
      where: { id: person.id, lastDigestAt: person.lastDigestAt },
      data: { lastDigestAt: at },
    });
    if (!claimed.count || now.getTime() - at.getTime() > 86_400_000) continue;
    const since = new Date(
      Math.max(
        person.lastDigestAt?.getTime() ?? 0,
        at.getTime() - 86_400_000,
        person.createdAt.getTime(),
      ),
    );
    const daily = (
      await Promise.all(
        emailKinds.map(async (item) =>
          (await deliveries(db() as never, [person.id], item.kind)).get(
            person.id,
          ) === "DIGEST"
            ? item.kind
            : null,
        ),
      )
    ).filter(Boolean) as string[];
    if (!daily.length) continue;
    const notes = await db().notification.findMany({
      where: {
        ...visibility(person),
        readAt: null,
        kind: { in: daily as never },
        createdAt: { gt: since, lte: at },
      },
      include: {
        actor: { select: { name: true } },
        board: { select: { name: true } },
        task: { select: { name: true, parent: { select: { name: true } } } },
      },
      orderBy: { createdAt: "asc" },
      take: 100,
    });
    if (!notes.length) continue;
    const time = new Intl.DateTimeFormat("en-GB", {
      timeZone: zone,
      hour: "2-digit",
      minute: "2-digit",
    });
    const groups = new Map<string, DigestItem[]>();
    for (const note of notes)
      groups.set(note.board.name, [
        ...(groups.get(note.board.name) ?? []),
        {
          kind: note.kind,
          line:
            note.kind === "AUTOMATION"
              ? note.message
              : `${note.actor.name} ${note.message} ${note.task?.name ?? ""}${note.task?.parent ? ` · Subitem of ${note.task.parent.name}` : ""}`.trim(),
          meta: time.format(note.createdAt),
        },
      ]);
    const hour = Number(
      new Intl.DateTimeFormat("en-GB", {
        timeZone: zone,
        hour: "2-digit",
        hourCycle: "h23",
      }).format(at),
    );
    const origin = configuredOrigin();
    const email = digestEmail(
      {
        appName: settings.name,
        firstName: person.name.trim().split(/\s+/)[0] ?? person.name,
        greeting: greetingFor(hour),
        groups: [...groups].map(([board, items]) => ({ board, items })),
        appUrl: `${origin}/`,
      },
      links(
        person.id,
        "DIGEST",
        `Sent at ${person.digestTime} because you chose the daily digest.`,
        "Stop the digest",
      ),
    );
    await db().emailMessage.create({
      data: {
        id: createRecordId(),
        userId: person.id,
        purpose: "digest",
        subject: email.subject,
        html: email.html,
        text: email.text,
      },
    });
    queued++;
  }
  return queued;
}

// ---------- API token expiry ----------

/** Emails each token's owner once, a week before the token expires. */
export async function warnExpiringTokens(now = new Date()) {
  const due = await db().apiToken.findMany({
    where: {
      revokedAt: null,
      expiryWarnedAt: null,
      expiresAt: { gt: now, lte: new Date(now.getTime() + 7 * 86_400_000) },
      user: { deactivatedAt: null },
    },
    take: 100,
  });
  if (!due.length) return 0;
  const settings = await db().installationSettings.findUnique({
    where: { id: "installation" },
  });
  for (const token of due) {
    // Claim it first so two workers don't both warn.
    const claimed = await db().apiToken.updateMany({
      where: { id: token.id, expiryWarnedAt: null },
      data: { expiryWarnedAt: now },
    });
    if (!claimed.count) continue;
    const email = tokenExpiryEmail({
      appName: settings?.name ?? "Yuzu",
      origin: configuredOrigin(),
      tokenName: token.name,
      expiresOn: token.expiresAt!.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        timeZone: settings?.timezone ?? "UTC",
      }),
    });
    await db().emailMessage.create({
      data: {
        id: createRecordId(),
        userId: token.userId,
        purpose: "security",
        ...email,
      },
    });
  }
  return due.length;
}

/** Sends due emails every few seconds and checks digests each minute. */
export function startEmailWorker() {
  let stopped = false;
  let running = false;
  let lastScan = 0;
  const tick = async () => {
    if (running || stopped) return;
    running = true;
    try {
      if (Date.now() - lastScan > 60_000) {
        lastScan = Date.now();
        await scanDigests();
        await warnExpiringTokens();
        // Trash auto-erase is cheap to check; it erases in bounded batches.
        await eraseExpiredTrash().catch(() =>
          console.error(JSON.stringify({ event: "trash_erase_failed" })),
        );
      }
      while (!stopped && (await processEmailQueue()) === 20);
    } catch {
      console.error(JSON.stringify({ event: "email_worker_error" }));
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => void tick(), 5_000);
  void tick();
  return {
    close: async () => {
      stopped = true;
      clearInterval(timer);
    },
  };
}
