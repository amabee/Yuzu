import { z } from "zod";
export const inviteSchema = z.strictObject({
  workspaceId: z.string().min(1).max(100),
  email: z
    .email()
    .max(254)
    .transform((email) => email.toLowerCase()),
});
export const invitationTokenSchema = z.strictObject({
  token: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
});
export const acceptInvitationSchema = invitationTokenSchema.extend({
  name: z.string().trim().min(1).max(100).optional(),
  password: z.string().min(12).max(128).optional(),
});
export const revokeSchema = z.strictObject({ id: z.string().min(1).max(100) });
export const removeMemberSchema = z.strictObject({
  workspaceId: z.string().min(1).max(100),
  userId: z.string().min(1).max(100),
});
export const teamStateSchema = z.object({
  workspaces: z.array(z.object({ id: z.string(), name: z.string() })),
  members: z.array(
    z.object({
      workspaceId: z.string(),
      userId: z.string(),
      name: z.string(),
      email: z.string(),
      role: z.string(),
    }),
  ),
  invitations: z.array(
    z.object({
      id: z.string(),
      workspaceId: z.string(),
      email: z.string(),
      expiresAt: z.string(),
      status: z.enum(["pending", "expired", "revoked", "accepted", "sending"]),
    }),
  ),
});
export type TeamState = z.infer<typeof teamStateSchema>;
export const invitationPreviewSchema = z.object({
  workspaceName: z.string(),
  email: z.string(),
  existingAccount: z.boolean(),
  signedInAsRecipient: z.boolean(),
  signedInAsOther: z.boolean(),
});
export type InvitationPreview = z.infer<typeof invitationPreviewSchema>;
export const invitationAcceptedSchema = z.object({
  accepted: z.literal(true),
  signedIn: z.boolean(),
});
