import { z } from "zod";
import { emailAddress, personId, recordId } from "./id-contract";
import type { CrmRecordType } from "./record-types";

/**
 * Company and Contact profile fields (docs/specs/companies-contacts.md).
 * They live in CompanyProfile/ContactProfile; the record's board has a system
 * column for each so approvals and labels can refer to them.
 */
export const profileFields = {
  legalName: { column: "legal_name", label: "Legal name", type: "TEXT" },
  website: { column: "website", label: "Website", type: "URL" },
  domain: { column: "domain", label: "Domain", type: "TEXT" },
  email: { column: "email", label: "Email", type: "EMAIL" },
  phone: { column: "phone", label: "Phone", type: "TEXT" },
  address: { column: "address", label: "Address", type: "LONG_TEXT" },
} as const;
export type ProfileKey = keyof typeof profileFields;
export const profileKeys = Object.keys(profileFields) as ProfileKey[];
/** Which profile fields each CRM type has, in display order. */
export const profileKeysFor: Record<CrmRecordType, readonly ProfileKey[]> = {
  COMPANY: ["domain", "legalName", "website", "email", "phone", "address"],
  CONTACT: ["email", "phone"],
};
/** Board-column labels where a type words a field differently. */
export const profileLabel = (type: CrmRecordType, key: ProfileKey) =>
  type === "COMPANY" && key === "email"
    ? "Main email"
    : type === "COMPANY" && key === "phone"
      ? "Main phone"
      : profileFields[key].label;
/** Where a Company or Contact (or its collection) opens. */
export const crmRecordHref = (type: CrmRecordType, recordId?: string) =>
  `/crm/${type === "COMPANY" ? "companies" : "contacts"}${recordId ? `?record=${recordId}` : ""}`;
/** Where a pipeline Deal (or the pipeline) opens. */
export const dealHref = (boardId: string, recordId?: string) =>
  `/crm/deals/${boardId}${recordId ? `?record=${recordId}` : ""}`;
export const profileColumnKeys = profileKeys.map(
  (key) => profileFields[key].column,
);

// Control characters other than tab and line breaks never belong in text.
const controls = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
const lineBreaks = /[\r\n]/;
/** Optional text: trimmed, blank becomes null. */
const optional = (max: number, label: string, multiline = false) =>
  z
    .string()
    .nullable()
    .transform((value) => (value ?? "").trim() || null)
    .refine((value) => value === null || value.length <= max, {
      message: `Use ${max.toLocaleString("en-US")} characters or fewer for ${label.toLowerCase()}.`,
    })
    .refine(
      (value) =>
        value === null ||
        (!controls.test(value) && (multiline || !lineBreaks.test(value))),
      { message: `Remove unsupported characters from ${label.toLowerCase()}.` },
    );

/** One address, at most 254 characters; the domain part is lowercased. */
export const crmEmail = optional(254, "Email")
  .refine((value) => value === null || emailAddress.safeParse(value).success, {
    message: "Enter an email like name@company.com.",
  })
  .transform((value) => {
    if (!value) return null;
    const at = value.lastIndexOf("@");
    return `${value.slice(0, at)}@${value.slice(at + 1).toLowerCase()}`;
  });

export const crmWebsite = optional(2048, "Website").superRefine(
  (value, context) => {
    if (value === null) return;
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      context.addIssue({
        code: "custom",
        message: "Enter a full web address, like https://example.com.",
      });
      return;
    }
    if (!["http:", "https:"].includes(url.protocol))
      context.addIssue({
        code: "custom",
        message: "Use a web address that starts with http:// or https://.",
      });
    else if (url.username || url.password)
      context.addIssue({
        code: "custom",
        message: "Remove the sign-in details from the web address.",
      });
  },
);

/** Hostname only, lowercase; international names become their ASCII form. */
export function normalizeDomain(input: string): string | null {
  const value = input.trim().toLowerCase().replace(/\.$/, "");
  if (!value || /[\s/:?#@*\\[\]%]/.test(value)) return null;
  let host: string;
  try {
    host = new URL(`http://${value}`).hostname;
  } catch {
    return null;
  }
  if (host.length > 253 || !host.includes(".")) return null;
  const label = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/;
  if (!host.split(".").every((part) => label.test(part))) return null;
  // Addresses like 10.0.0.1 aren't company domains.
  if (/^\d+(\.\d+)*$/.test(host)) return null;
  return host;
}
export const crmDomain = optional(253, "Domain").transform((value, context) => {
  if (value === null) return null;
  const domain = normalizeDomain(value);
  if (!domain) {
    context.addIssue({
      code: "custom",
      message: "Enter just the domain, like example.com.",
    });
    return z.NEVER;
  }
  return domain;
});

export const profileSchemas = {
  legalName: optional(200, "Legal name"),
  website: crmWebsite,
  domain: crmDomain,
  email: crmEmail,
  phone: optional(64, "Phone"),
  address: optional(1000, "Address", true),
} satisfies Record<ProfileKey, z.ZodType>;
/** Profile edits as they appear in record create/update changes. */
export const profileChangesSchema = z.object(profileSchemas).partial().strict();
export type ProfileValues = Record<ProfileKey, string | null>;
export const emptyProfile = (): ProfileValues =>
  Object.fromEntries(profileKeys.map((key) => [key, null])) as ProfileValues;

// ---------- Directory ----------

export const CRM_PAGE_SIZE = 50;
export const crmSorts = ["name", "-name", "created", "-created"] as const;
export const crmDirectoryQuerySchema = z
  .object({
    type: z.enum(["COMPANY", "CONTACT"]),
    q: z.string().trim().max(200).default(""),
    archived: z.boolean().default(false),
    sort: z.enum(crmSorts).default("name"),
    page: z.number().int().min(1).max(10_000).default(1),
  })
  .strict();
export type CrmDirectoryQuery = z.infer<typeof crmDirectoryQuerySchema>;

const person = z.object({
  id: personId,
  name: z.string(),
  image: z.string().nullable().optional(),
  deactivated: z.boolean().optional(),
});
export const crmRecordSchema = z.object({
  id: recordId,
  name: z.string(),
  description: z.string(),
  ownerId: personId.nullable(),
  createdById: personId,
  createdAt: z.string(),
  updatedAt: z.string(),
  archivedAt: z.string().nullable(),
  revision: z.number().int().positive(),
  canEdit: z.boolean(),
  commentCount: z.number().int().nonnegative(),
  attachmentCount: z.number().int().nonnegative(),
  /** Contacts: their primary company, if the viewer can see it. */
  primaryCompany: z
    .object({ id: recordId, name: z.string() })
    .nullable()
    .optional(),
  /** Companies: people currently linked that the viewer can see. */
  currentPeople: z.number().int().nonnegative().optional(),
  profile: z.object(
    Object.fromEntries(
      profileKeys.map((key) => [key, z.string().nullable()]),
    ) as Record<ProfileKey, z.ZodNullable<z.ZodString>>,
  ),
});
export type CrmRecord = z.infer<typeof crmRecordSchema>;
export const crmDirectorySchema = z.object({
  type: z.enum(["COMPANY", "CONTACT"]),
  boardId: recordId,
  workspaceId: recordId,
  currentUserId: personId,
  canCreate: z.boolean(),
  canManage: z.boolean(),
  /** Approvals on the collection: edits to protected fields become requests. */
  approvals: z.boolean(),
  people: z.array(person),
  records: z.array(crmRecordSchema),
  page: z.number().int().positive(),
  pageCount: z.number().int().nonnegative(),
  /** Whole-collection count for the current search and archive filter. */
  total: z.number().int().nonnegative(),
  /** Live (not archived) records in the collection, ignoring search. */
  liveTotal: z.number().int().nonnegative(),
});
export type CrmDirectory = z.infer<typeof crmDirectorySchema>;

export const crmRecordQuerySchema = z.object({ recordId }).strict();
export const crmRecordDetailSchema = z.object({
  type: z.enum(["COMPANY", "CONTACT"]),
  boardId: recordId,
  record: crmRecordSchema,
  activity: z.array(
    z.object({
      id: recordId,
      action: z.string(),
      actor: z.string(),
      createdAt: z.string(),
      changes: z.array(
        z.object({
          field: z.string(),
          from: z.string().nullable(),
          to: z.string().nullable(),
        }),
      ),
    }),
  ),
});
export type CrmRecordDetail = z.infer<typeof crmRecordDetailSchema>;

// ---------- Duplicate suggestions ----------

export const crmMatchQuerySchema = z
  .object({
    type: z.enum(["COMPANY", "CONTACT"]),
    name: z.string().trim().max(200).default(""),
    email: z.string().trim().max(254).default(""),
    domain: z.string().trim().max(253).default(""),
    /** Leave this record out, when checking an existing one. */
    exclude: recordId.optional(),
  })
  .strict();
export const crmMatchReasons = ["EMAIL", "DOMAIN", "NAME"] as const;
export const crmMatchesSchema = z.array(
  z.object({
    id: recordId,
    name: z.string(),
    detail: z.string().nullable(),
    archived: z.boolean(),
    reason: z.enum(crmMatchReasons),
  }),
);
export type CrmMatches = z.infer<typeof crmMatchesSchema>;
export const CRM_MATCH_LIMIT = 5;

// ---------- Contact–Company links (slice 1b) ----------

/** A contact may have at most this many company links, former ones included. */
export const MAX_COMPANY_LINKS = 100;
export const LINK_PAGE_SIZE = 50;
export const linkStatuses = ["CURRENT", "FORMER"] as const;
export type LinkStatus = (typeof linkStatuses)[number];
export const linkRole = optional(120, "Role");

export const linkCreateSchema = z
  .object({
    contactId: recordId,
    companyId: recordId,
    role: linkRole.optional(),
    status: z.enum(linkStatuses).default("CURRENT"),
    requestKey: recordId,
  })
  .strict();
export const linkUpdateSchema = z
  .object({
    linkId: recordId,
    revision: z.number().int().positive(),
    requestKey: recordId,
    changes: z
      .object({ role: linkRole, status: z.enum(linkStatuses) })
      .partial()
      .strict()
      .refine(
        (value) => Object.keys(value).length > 0,
        "Change the role or status.",
      ),
    /** Marking the primary company Former also clears it, explicitly. */
    clearPrimary: z.boolean().default(false),
    primaryRevision: z.number().int().nonnegative().optional(),
  })
  .strict();
export const linkPrimarySchema = z
  .object({
    contactId: recordId,
    /** The new primary link, or null to clear the primary company. */
    linkId: recordId.nullable(),
    linkRevision: z.number().int().positive().optional(),
    primaryRevision: z.number().int().nonnegative(),
    requestKey: recordId,
  })
  .strict();
export const linkRemoveSchema = z
  .object({
    linkId: recordId,
    revision: z.number().int().positive(),
    requestKey: recordId,
    clearPrimary: z.boolean().default(false),
    primaryRevision: z.number().int().nonnegative().optional(),
  })
  .strict();

const linkedRecord = z.object({
  id: recordId,
  name: z.string(),
  detail: z.string().nullable(),
  archived: z.boolean(),
});
export const crmLinkSchema = z.discriminatedUnion("visible", [
  z.object({
    visible: z.literal(true),
    id: recordId,
    revision: z.number().int().positive(),
    role: z.string().nullable(),
    status: z.enum(linkStatuses),
    isPrimary: z.boolean(),
    /** The record at the other end of the link. */
    record: linkedRecord,
    /** Whether the viewer may change this link (the contact's editors). */
    canEdit: z.boolean(),
  }),
  // A link to a record the viewer can't see: no name, role or ids.
  z.object({
    visible: z.literal(false),
    key: z.string(),
    status: z.enum(linkStatuses),
  }),
]);
export type CrmLink = z.infer<typeof crmLinkSchema>;
export const crmLinksQuerySchema = z
  .object({
    recordId,
    page: z.number().int().min(1).max(1000).default(1),
  })
  .strict();
export const crmLinksSchema = z.object({
  side: z.enum(["CONTACT", "COMPANY"]),
  links: z.array(crmLinkSchema),
  page: z.number().int().positive(),
  pageCount: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  /** Contacts only: the token for changing the primary company. */
  primaryRevision: z.number().int().nonnegative().nullable(),
  /** Whether the viewer may add links here. */
  canLink: z.boolean(),
  /** Why links can't be changed here right now, if they can't. */
  blocked: z.string().nullable(),
});
export type CrmLinks = z.infer<typeof crmLinksSchema>;
export const linkResultSchema = z.object({
  outcome: z.enum([
    "LINKED",
    "ALREADY_LINKED",
    "UPDATED",
    "REMOVED",
    "PRIMARY_SET",
  ]),
  linkId: recordId.nullable(),
  contactId: recordId,
  companyId: recordId.nullable(),
  contactBoardId: recordId,
  companyBoardId: recordId,
  primaryRevision: z.number().int().nonnegative(),
  revision: z.number().int().positive().nullable(),
});
export type LinkResult = z.infer<typeof linkResultSchema>;
