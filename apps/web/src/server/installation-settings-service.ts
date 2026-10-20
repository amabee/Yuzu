import { getDatabase } from "@yuzu/database";
import { z } from "zod";
import { requireAdministrator } from "./team-access";
import { SetupError } from "./setup/security";
import { currencyCode } from "@/lib/record-types";

export const calendarSettingsSchema = z.strictObject({
  revision: z.number().int().positive(),
  weekStartsOn: z.union([z.literal(0), z.literal(1)]),
});

/** Installation-wide calendar preferences; owners and admins only. */
export async function updateCalendarSettings(input: unknown, headers: Headers) {
  await requireAdministrator(headers);
  const body = calendarSettingsSchema.parse(input);
  const updated = await getDatabase().installationSettings.updateMany({
    where: { id: "installation", revision: body.revision },
    data: {
      weekStartsOn: body.weekStartsOn,
      revision: { increment: 1 },
    },
  });
  if (updated.count === 0)
    throw new SetupError(
      409,
      "SETTINGS_CHANGED",
      "Settings changed since you opened them. Reload and try again.",
    );
  return { weekStartsOn: body.weekStartsOn, revision: body.revision + 1 };
}

export const currencySettingsSchema = z.strictObject({
  revision: z.number().int().positive(),
  currency: currencyCode,
});

/** The currency that currency number fields show; owners and admins only. */
export async function updateCurrencySettings(input: unknown, headers: Headers) {
  await requireAdministrator(headers);
  const body = currencySettingsSchema.parse(input);
  try {
    new Intl.NumberFormat("en", { style: "currency", currency: body.currency });
  } catch {
    throw new SetupError(
      422,
      "INVALID_CURRENCY",
      "Yuzu doesn't know that currency.",
    );
  }
  const updated = await getDatabase().installationSettings.updateMany({
    where: { id: "installation", revision: body.revision },
    data: { currency: body.currency, revision: { increment: 1 } },
  });
  if (updated.count === 0)
    throw new SetupError(
      409,
      "SETTINGS_CHANGED",
      "Settings changed since you opened them. Reload and try again.",
    );
  return { currency: body.currency, revision: body.revision + 1 };
}

export const automationSettingsSchema = z.strictObject({
  revision: z.number().int().positive(),
  allowPrivateWebhooks: z.boolean(),
});

/** Whether automation webhooks may reach local or private-network addresses. */
export async function updateAutomationSettings(
  input: unknown,
  headers: Headers,
) {
  await requireAdministrator(headers);
  const body = automationSettingsSchema.parse(input);
  const updated = await getDatabase().installationSettings.updateMany({
    where: { id: "installation", revision: body.revision },
    data: {
      allowPrivateWebhooks: body.allowPrivateWebhooks,
      revision: { increment: 1 },
    },
  });
  if (updated.count === 0)
    throw new SetupError(
      409,
      "SETTINGS_CHANGED",
      "Settings changed since you opened them. Reload and try again.",
    );
  return {
    allowPrivateWebhooks: body.allowPrivateWebhooks,
    revision: body.revision + 1,
  };
}
