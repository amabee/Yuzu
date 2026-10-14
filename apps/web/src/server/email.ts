import nodemailer from "nodemailer";
import { getDatabase } from "@yuzu/database";
import { smtpSchema } from "@/lib/setup-contract";
import { decryptSettings, SetupError } from "./setup/security";

type EmailSettings = {
  name: string;
  emailConfig: string | null;
  emailConfigRevision: number;
  emailVerifiedRevision: number | null;
};

export async function verifiedEmailSettings() {
  const settings = await getDatabase().installationSettings.findUnique({
    where: { id: "installation" },
  });
  if (settings?.setupState !== "READY")
    throw new SetupError(
      503,
      "RECOVERY_UNAVAILABLE",
      "Password recovery is available after installation and email setup are complete.",
    );
  smtpConfiguration(settings);
  return settings;
}

function smtpConfiguration(settings: EmailSettings) {
  if (
    !settings.emailConfig ||
    settings.emailVerifiedRevision !== settings.emailConfigRevision
  )
    throw new SetupError(
      503,
      "EMAIL_REQUIRED",
      "Verified email configuration is required.",
    );
  return smtpSchema.parse(decryptSettings(settings.emailConfig));
}

export async function sendVerifiedEmail(
  settings: EmailSettings,
  to: string,
  subject: string,
  text: string,
) {
  const smtp = smtpConfiguration(settings);
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
    const result = await transport.sendMail({
      from: { name: settings.name, address: smtp.fromEmail },
      to,
      subject,
      text,
    });
    if (!result.accepted.length)
      throw new Error("SMTP did not accept the recipient.");
  } finally {
    transport.close();
  }
}
