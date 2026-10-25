import type { DatabaseTransaction } from "@yuzu/database";
import {
  profileKeys,
  profileKeysFor,
  profileLabel,
  type ProfileKey,
} from "@/lib/crm-contract";
import { asRecordType, isCrmRecordType } from "@/lib/record-types";
import { SetupError } from "./setup/security";

/**
 * Company/Contact profile values on the shared record paths. Record create,
 * update, approvals and automation carry them as flat change keys (email,
 * domain, ...); this module checks them against the board's type and stores
 * them in the profile table, never as custom field values.
 */
type Board = { id: string; workspaceId: string; recordType: string };
type Profile = Partial<Record<ProfileKey, string | null>> & {
  emailKey?: string | null;
};

/** The profile part of a change set, and everything else. */
export function splitProfile<T extends Record<string, unknown>>(changes: T) {
  const profile: Partial<Record<ProfileKey, string | null>> = {};
  const rest: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(changes))
    if ((profileKeys as string[]).includes(key))
      profile[key as ProfileKey] = value as string | null;
    else rest[key] = value;
  return { profile, rest: rest as Omit<T, ProfileKey> };
}

/** Rejects profile fields the board's records don't have. */
export function checkProfileRules(
  changes: Record<string, unknown>,
  board: { recordType: string },
) {
  const type = asRecordType(board.recordType);
  const allowed: readonly string[] = isCrmRecordType(type)
    ? profileKeysFor[type]
    : [];
  const key = Object.keys(changes).find(
    (key) =>
      (profileKeys as string[]).includes(key) &&
      changes[key] !== undefined &&
      !allowed.includes(key),
  );
  if (key)
    throw new SetupError(
      422,
      "FIELD_NOT_AVAILABLE",
      isCrmRecordType(type)
        ? `${type === "COMPANY" ? "Companies" : "Contacts"} don't have this field.`
        : "This field is only available on Companies and Contacts.",
    );
}

const withKeys = (profile: Partial<Record<ProfileKey, string | null>>) => ({
  ...profile,
  ...(profile.email !== undefined
    ? { emailKey: profile.email?.toLowerCase() ?? null }
    : {}),
});

/** Creates the profile a new Company/Contact record needs; no-op elsewhere. */
export async function createProfile(
  tx: DatabaseTransaction,
  recordId: string,
  board: Board,
  values: Partial<Record<ProfileKey, string | null>>,
) {
  const data = {
    recordId,
    workspaceId: board.workspaceId,
    ...withKeys(values),
  };
  if (board.recordType === "COMPANY") await tx.companyProfile.create({ data });
  else if (board.recordType === "CONTACT") {
    const { email, emailKey, phone } = data as Profile;
    await tx.contactProfile.create({
      data: {
        recordId,
        workspaceId: board.workspaceId,
        email,
        emailKey,
        phone,
      },
    });
  }
}

export async function updateProfile(
  tx: DatabaseTransaction,
  recordId: string,
  board: Board,
  values: Partial<Record<ProfileKey, string | null>>,
) {
  if (!Object.keys(values).length) return;
  const data = withKeys(values);
  if (board.recordType === "COMPANY")
    await tx.companyProfile.update({ where: { recordId }, data });
  else if (board.recordType === "CONTACT")
    await tx.contactProfile.update({ where: { recordId }, data });
}

/** Profile values for snapshots, activity and approvals, by change key. */
export function profileSnapshot(
  task: {
    companyProfile?: Profile | null;
    contactProfile?: Profile | null;
  },
  type?: string,
): Partial<Record<ProfileKey, string | null>> {
  const profile = task.companyProfile ?? task.contactProfile;
  if (!profile) return {};
  const kind = isCrmRecordType(type)
    ? type
    : task.companyProfile
      ? "COMPANY"
      : "CONTACT";
  return Object.fromEntries(
    profileKeysFor[kind].map((key) => [key, profile[key] ?? null]),
  );
}

/** "Main email", "Domain": what activity calls a changed profile field. */
export const profileChangeLabel = (type: string, key: ProfileKey) =>
  isCrmRecordType(type) ? profileLabel(type, key) : key;

/**
 * Company and Contact collections are system boards: they can't be archived,
 * moved, deleted, reshaped, imported into or automated from Work screens.
 * Their type never changes, so reading it outside the caller's transaction
 * is safe.
 */
export async function refuseCrmCollection(input: unknown, what: string) {
  const boardId = (input as { boardId?: unknown } | null)?.boardId;
  if (typeof boardId !== "string") return;
  const { getDatabase } = await import("@yuzu/database");
  const board = await getDatabase().board.findUnique({
    where: { id: boardId },
    select: { recordType: true },
  });
  if (board && isCrmRecordType(board.recordType))
    throw new SetupError(
      409,
      "CRM_COLLECTION",
      `${what} isn't available for Companies and Contacts.`,
    );
}
