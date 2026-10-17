import { z } from "zod";
import { recordId } from "./id-contract";

/** Project colors are palette keys, mapped to theme tokens in the UI, never raw hex. */
export const projectColors = [
  "teal",
  "blue",
  "sky",
  "citrus",
  "green",
  "coral",
  "rose",
  "slate",
] as const;
export const projectVisibilities = ["PUBLIC", "PRIVATE"] as const;
export const projectRoles = ["MANAGER", "MEMBER"] as const;

const name = z
  .string()
  .trim()
  .min(1, "Enter a project name.")
  .max(80, "Use 80 characters or fewer.");
const email = z
  .email()
  .max(254)
  .transform((value) => value.toLowerCase());

export const projectListSchema = z.strictObject({
  workspaceId: recordId,
  archived: z.enum(["true", "false"]).default("false"),
});
export const projectCreateSchema = z.strictObject({
  workspaceId: recordId,
  name,
  color: z.enum(projectColors),
  visibility: z.enum(projectVisibilities),
});
export const projectUpdateSchema = z
  .strictObject({
    projectId: recordId,
    revision: z.number().int().positive(),
    name: name.optional(),
    color: z.enum(projectColors).optional(),
    visibility: z.enum(projectVisibilities).optional(),
  })
  .refine(
    (body) =>
      body.name !== undefined ||
      body.color !== undefined ||
      body.visibility !== undefined,
    "Change at least one setting.",
  );
export const projectReorderSchema = z.strictObject({
  workspaceId: recordId,
  projectIds: z.array(recordId).min(1).max(200),
});
export const projectIdSchema = z.strictObject({ projectId: recordId });
export const projectMemberSchema = z.discriminatedUnion("action", [
  z.strictObject({
    action: z.literal("add"),
    projectId: recordId,
    userId: z.string().min(1).max(100),
    role: z.enum(projectRoles),
  }),
  z.strictObject({
    action: z.literal("role"),
    projectId: recordId,
    userId: z.string().min(1).max(100),
    role: z.enum(projectRoles),
  }),
  z.strictObject({
    action: z.literal("remove"),
    projectId: recordId,
    userId: z.string().min(1).max(100),
  }),
]);
export const projectInviteSchema = z.strictObject({
  projectId: recordId,
  email,
  role: z.enum(projectRoles),
});
export const projectInviteRevokeSchema = z.strictObject({ id: recordId });
export const projectRecoverSchema = z.strictObject({
  projectId: recordId,
  // The admin types the project name to confirm a deliberate, audited action.
  confirmName: z.string().trim().min(1).max(80),
});
export const moveBoardSchema = z.strictObject({
  boardId: recordId,
  projectId: recordId.nullable(), // null moves the board out to standalone
});

export type ProjectSummary = {
  id: string;
  workspaceId: string;
  name: string;
  color: (typeof projectColors)[number];
  visibility: (typeof projectVisibilities)[number];
  position: number;
  archived: boolean;
  revision: number;
  role: (typeof projectRoles)[number] | null;
  canManage: boolean;
  boards: { id: string; name: string; position: number }[];
};
