/**
 * Notification emails: table layout and inline styles so they survive email
 * apps, with a plain-text twin. Every inserted value is escaped.
 */

const colors = {
  ink: "#0A2633",
  muted: "#5E7480",
  line: "#DCE5EA",
  page: "#EEF3F5",
  primary: "#0B5A7A",
  yuzu: "#F6C945",
  wash: "#FFF8E1",
};
const font =
  "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

export function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

type Links = {
  /** Absolute app origin, e.g. https://yuzu.example.com. */
  origin: string;
  settingsUrl: string;
  unsubscribeUrl: string;
  /** Why the person got this, e.g. "You get these instantly for assignments." */
  reason: string;
  unsubscribeLabel: string;
};

function layout(body: string, links: Links, appName: string) {
  const e = escapeHtml;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${e(appName)}</title></head>
<body style="margin:0;padding:0;background:${colors.page};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${colors.page};"><tr><td align="center" style="padding:28px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid ${colors.line};border-radius:18px;font-family:${font};color:${colors.ink};">
<tr><td style="padding:24px 26px 0;background:${colors.wash};border-radius:18px 18px 0 0;">
<table role="presentation" cellpadding="0" cellspacing="0"><tr>
<td style="vertical-align:middle;"><img src="${e(links.origin)}/email/yuzu-logo.png" width="32" height="32" alt="" style="display:block;border:0;"></td>
<td style="vertical-align:middle;padding-left:8px;font-size:18px;font-weight:800;letter-spacing:-0.02em;">${e(appName.toLowerCase() === "yuzu" ? "yuzu" : appName)}</td>
</tr></table></td></tr>
<tr><td style="padding:18px 26px 24px;">${body}</td></tr>
</table>
<p style="max-width:560px;margin:16px auto 0;font-family:${font};font-size:12px;line-height:1.6;color:${colors.muted};text-align:center;">${e(links.reason)}<br><a href="${e(links.settingsUrl)}" style="color:${colors.primary};">Email settings</a> &middot; <a href="${e(links.unsubscribeUrl)}" style="color:${colors.primary};">${e(links.unsubscribeLabel)}</a></p>
</td></tr></table></body></html>`;
}

function button(href: string, label: string) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:20px;"><tr><td style="background:${colors.primary};border-radius:11px;"><a href="${escapeHtml(href)}" style="display:inline-block;padding:11px 20px;color:#ffffff;font-weight:700;font-size:14px;text-decoration:none;">${escapeHtml(label)}</a></td></tr></table>`;
}

function textFooter(links: Links) {
  return `\n\n—\n${links.reason}\nEmail settings: ${links.settingsUrl}\n${links.unsubscribeLabel}: ${links.unsubscribeUrl}\n`;
}

export type InstantEmail = {
  appName: string;
  kind: string;
  actorName: string;
  /** The notification's message; rule messages are whole sentences. */
  message: string;
  taskName: string;
  boardName: string;
  projectName: string | null;
  taskUrl: string;
  details?: { status?: string; due?: string; priority?: string };
};

/** The short subject line for one notification. */
export function instantSubject(
  input: Pick<InstantEmail, "kind" | "actorName" | "message" | "taskName">,
) {
  const first = input.actorName.trim().split(/\s+/)[0] ?? input.actorName;
  const clip = (value: string) =>
    value.length > 120 ? `${value.slice(0, 117)}…` : value;
  switch (input.kind) {
    case "ASSIGNMENT":
      return clip(`${first} assigned you: ${input.taskName}`);
    case "MENTION":
      return clip(`${first} mentioned you: ${input.taskName}`);
    case "APPROVAL_REQUEST":
      return clip(`Approval needed: ${input.taskName}`);
    case "APPROVAL_DECISION":
      return clip(`${first} ${input.message}: ${input.taskName}`);
    default:
      return clip(input.message);
  }
}

/** One notification as an email. */
export function instantEmail(input: InstantEmail, links: Links) {
  const e = escapeHtml;
  const sentence = input.kind === "AUTOMATION";
  const heading = sentence
    ? input.message
    : `${input.actorName} ${input.message}`;
  const where = `${input.projectName ? `${input.projectName} · ` : ""}${input.boardName}`;
  const chips = [
    input.details?.status,
    input.details?.due ? `Due ${input.details.due}` : undefined,
    input.details?.priority,
  ].filter(Boolean) as string[];
  const body = `<h1 style="margin:0;font-size:21px;line-height:1.3;font-weight:800;letter-spacing:-0.02em;">${e(heading)}</h1>
<p style="margin:6px 0 0;font-size:14px;color:${colors.muted};">On <b style="color:${colors.ink};">${e(where)}</b></p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:16px;border:1px solid ${colors.line};border-radius:12px;"><tr><td style="padding:12px 14px;">
<div style="font-size:15px;font-weight:700;">${e(input.taskName)}</div>
${chips.length ? `<div style="margin-top:8px;">${chips.map((chip) => `<span style="display:inline-block;margin:0 6px 4px 0;padding:2px 9px;border-radius:99px;background:${colors.page};color:${colors.muted};font-size:12px;font-weight:700;">${e(chip)}</span>`).join("")}</div>` : ""}
</td></tr></table>
${button(input.taskUrl, "Open the task")}`;
  const subject = instantSubject(input);
  const text = `${heading}\nOn ${where}\n\n${input.taskName}${chips.length ? `\n${chips.join(" · ")}` : ""}\n\nOpen the task: ${input.taskUrl}${textFooter(links)}`;
  return { subject, html: layout(body, links, input.appName), text };
}

export type DigestItem = {
  kind: string;
  /** e.g. "Sarah approved your due date change on Timeline zoom". */
  line: string;
  meta: string;
};
const digestIcon: Record<string, { mark: string; bg: string; fg: string }> = {
  ASSIGNMENT: { mark: "+", bg: "#E3F4EA", fg: "#1E9E58" },
  MENTION: { mark: "@", bg: "#E4EDFB", fg: "#2F6FE0" },
  APPROVAL_REQUEST: { mark: "?", bg: "#FFEFC4", fg: "#6B4A00" },
  APPROVAL_DECISION: { mark: "✓", bg: "#FFEFC4", fg: "#6B4A00" },
  AUTOMATION: { mark: "⚡", bg: "#FFF3CF", fg: "#B7791F" },
};

/** The once-a-day roundup of unread notifications, grouped by board. */
export function digestEmail(
  input: {
    appName: string;
    firstName: string;
    greeting: string;
    groups: { board: string; items: DigestItem[] }[];
    appUrl: string;
  },
  links: Links,
) {
  const e = escapeHtml;
  const count = input.groups.reduce(
    (sum, group) => sum + group.items.length,
    0,
  );
  const subject = `${count} ${count === 1 ? "update" : "updates"} on ${input.appName} today`;
  const groups = input.groups
    .map(
      (
        group,
      ) => `<div style="margin-top:18px;font-size:12px;font-weight:700;color:${colors.muted};">${e(group.board)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${group.items
        .map((item, index) => {
          const icon = digestIcon[item.kind] ?? digestIcon.AUTOMATION!;
          return `<tr><td style="padding:9px 0;${index ? `border-top:1px solid ${colors.line};` : ""}vertical-align:top;width:36px;"><div style="width:26px;height:26px;line-height:26px;border-radius:99px;text-align:center;background:${icon.bg};color:${icon.fg};font-size:12px;font-weight:700;">${e(icon.mark)}</div></td>
<td style="padding:9px 0;${index ? `border-top:1px solid ${colors.line};` : ""}font-size:14px;"><div>${e(item.line)}</div><div style="margin-top:2px;font-size:12px;color:${colors.muted};">${e(item.meta)}</div></td></tr>`;
        })
        .join("")}</table>`,
    )
    .join("");
  const body = `<h1 style="margin:0;font-size:21px;line-height:1.3;font-weight:800;letter-spacing:-0.02em;">${e(input.greeting)}, ${e(input.firstName)}</h1>
<p style="margin:6px 0 0;font-size:14px;color:${colors.muted};">Here's what you haven't seen yet.</p>
${groups}
${button(input.appUrl, `Open ${input.appName}`)}`;
  const text = `${input.greeting}, ${input.firstName}\nHere's what you haven't seen yet.\n${input.groups
    .map(
      (group) =>
        `\n${group.board}\n${group.items.map((item) => `- ${item.line} (${item.meta})`).join("\n")}`,
    )
    .join("\n")}\n\nOpen ${input.appName}: ${input.appUrl}${textFooter(links)}`;
  return { subject, html: layout(body, links, input.appName), text };
}

/** A rule's own email: its subject and message, linking to the task. */
export function ruleEmail(
  input: {
    appName: string;
    subject: string;
    message: string;
    ruleName: string;
    taskName: string | null;
    taskUrl: string;
  },
  links: Links,
) {
  const e = escapeHtml;
  const body = `<h1 style="margin:0;font-size:21px;line-height:1.3;font-weight:800;letter-spacing:-0.02em;">${e(input.message)}</h1>
<p style="margin:6px 0 0;font-size:13px;color:${colors.muted};">From the “${e(input.ruleName)}” rule${input.taskName ? ` · ${e(input.taskName)}` : ""}</p>
${button(input.taskUrl, input.taskName ? "Open the task" : `Open ${input.appName}`)}`;
  const text = `${input.message}\nFrom the “${input.ruleName}” rule${input.taskName ? ` · ${input.taskName}` : ""}\n\n${input.taskUrl}${textFooter(links)}`;
  return {
    subject: input.subject,
    html: layout(body, links, input.appName),
    text,
  };
}
