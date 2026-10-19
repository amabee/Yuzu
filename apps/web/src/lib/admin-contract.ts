import { z } from "zod";

const id = z.string().min(1).max(100);
export const personActionSchema = z.strictObject({ userId: id });
export const roleChangeSchema = z.strictObject({
  userId: id,
  role: z.enum(["ADMIN", "MEMBER"]),
});
export const transferSchema = z.strictObject({
  userId: id,
  password: z.string().min(1, "Enter your password.").max(128),
});
export const workspaceActionSchema = z.strictObject({ workspaceId: id });
export const workspaceRenameSchema = z.strictObject({
  workspaceId: id,
  name: z.string().trim().min(1, "Enter a name.").max(80),
});

export const peopleStateSchema = z.object({
  currentUserId: z.string(),
  isOwner: z.boolean(),
  invitationsWaiting: z.number(),
  people: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      email: z.string(),
      image: z.string().nullable(),
      role: z.string(),
      workspaces: z.array(z.string()),
      lastActiveAt: z.string().nullable(),
      deactivatedAt: z.string().nullable(),
      deactivatedBy: z.string().nullable(),
      rules: z.number(),
    }),
  ),
});
export type PeopleState = z.infer<typeof peopleStateSchema>;
export type AdminPerson = PeopleState["people"][number];

export const workspacesStateSchema = z.object({
  workspaces: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      archivedAt: z.string().nullable(),
      boards: z.number(),
      members: z.number(),
    }),
  ),
});
export type WorkspacesState = z.infer<typeof workspacesStateSchema>;

/** Audit actions, grouped for the log's filter. */
export const auditKinds = {
  people: {
    label: "People and roles",
    actions: [
      "ROLE_CHANGED",
      "USER_DEACTIVATED",
      "USER_REACTIVATED",
      "OWNERSHIP_TRANSFERRED",
    ],
  },
  access: {
    label: "Invitations and access",
    actions: [
      "INVITATION_SENT",
      "INVITATION_REVOKED",
      "INVITATION_ACCEPTED",
      "MEMBER_REMOVED",
      "PROJECT_INVITATION_SENT",
      "PROJECT_INVITATION_REVOKED",
      "PROJECT_INVITATION_ACCEPTED",
      "PROJECT_ACCESS_RECOVERED",
    ],
  },
  security: { label: "Sign-in security", actions: ["SIGN_IN_LOCKED"] },
  workspaces: {
    label: "Workspaces",
    actions: ["WORKSPACE_RENAMED", "WORKSPACE_ARCHIVED", "WORKSPACE_RESTORED"],
  },
  data: { label: "Exports", actions: ["CSV_EXPORTED"] },
  api: {
    label: "API tokens",
    actions: ["API_TOKEN_CREATED", "API_TOKEN_REVOKED"],
  },
} as const;
export type AuditKind = keyof typeof auditKinds;
export const auditRanges = {
  "7": "Last 7 days",
  "30": "Last 30 days",
  "90": "Last 90 days",
  all: "All time",
} as const;

export const auditQuerySchema = z.strictObject({
  actorId: id.optional(),
  kind: z
    .enum(Object.keys(auditKinds) as [AuditKind, ...AuditKind[]])
    .optional(),
  range: z.enum(["7", "30", "90", "all"]).default("30"),
  before: id.optional(),
});
export type AuditQuery = z.input<typeof auditQuerySchema>;

export const auditPageSchema = z.object({
  events: z.array(
    z.object({
      id: z.string(),
      action: z.string(),
      actor: z.string().nullable(),
      subject: z.string(),
      workspace: z.string().nullable(),
      details: z.string().nullable(),
      createdAt: z.string(),
    }),
  ),
  next: z.string().nullable(),
  people: z.array(z.object({ id: z.string(), name: z.string() })),
});
export type AuditEntry = z.infer<typeof auditPageSchema>["events"][number];

/** The words after the actor's name, e.g. "deactivated Dana Soto". */
export function auditSentence(
  entry: Pick<AuditEntry, "action" | "subject" | "details">,
) {
  const { subject, details } = entry;
  switch (entry.action) {
    case "ROLE_CHANGED":
      return `made ${subject} ${details ?? "a member"}`;
    case "USER_DEACTIVATED":
      return `deactivated ${subject}`;
    case "USER_REACTIVATED":
      return `reactivated ${subject}`;
    case "OWNERSHIP_TRANSFERRED":
      return `transferred ownership to ${subject}`;
    case "INVITATION_SENT":
      return `invited ${subject}`;
    case "INVITATION_REVOKED":
      return `revoked the invitation for ${subject}`;
    case "INVITATION_ACCEPTED":
      return `joined (${subject})`;
    case "MEMBER_REMOVED":
      return `removed ${subject} from the workspace`;
    case "PROJECT_INVITATION_SENT":
      return `invited ${subject} to a project`;
    case "PROJECT_INVITATION_REVOKED":
      return `revoked a project invitation for ${subject}`;
    case "PROJECT_INVITATION_ACCEPTED":
      return `joined a project (${subject})`;
    case "PROJECT_ACCESS_RECOVERED":
      return "recovered access to a private project";
    case "SIGN_IN_LOCKED":
      return `Sign-in locked for ${subject}`;
    case "WORKSPACE_RENAMED":
      return `renamed the workspace ${details ?? ""} to ${subject}`.replace(
        "  ",
        " ",
      );
    case "WORKSPACE_ARCHIVED":
      return `archived the workspace ${subject}`;
    case "WORKSPACE_RESTORED":
      return `restored the workspace ${subject}`;
    case "API_TOKEN_CREATED":
      return `created the API token “${subject}”`;
    case "API_TOKEN_REVOKED":
      return `revoked the API token “${subject}”`;
    case "CSV_EXPORTED":
      return `exported ${subject} to CSV`;
    default:
      return `${entry.action.toLowerCase().replaceAll("_", " ")}: ${subject}`;
  }
}
