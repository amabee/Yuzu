import { createHmac, randomBytes } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { getDatabase } from "@yuzu/database";
import { decryptSettings, encryptSettings, SetupError } from "./setup/security";

const db = () => getDatabase();
/** Delays before each retry; the first attempt is immediate. */
const RETRY_DELAYS = [30_000, 120_000, 600_000];
const TIMEOUT_MS = 10_000;

/** A new signing secret, its stored (encrypted) form and its display form. */
export function newWebhookSecret() {
  const secret = `whsec_${randomBytes(24).toString("base64url")}`;
  return { secret, stored: encryptSettings(secret) };
}

/** `t=<unix seconds>,v1=<hex HMAC-SHA256 of "t.body">`, like common webhook senders. */
export function signWebhook(secret: string, body: string, at = Date.now()) {
  const t = Math.floor(at / 1000);
  const v1 = createHmac("sha256", secret).update(`${t}.${body}`).digest("hex");
  return `t=${t},v1=${v1}`;
}

function privateV4(ip: string) {
  const [a, b] = ip.split(".").map(Number) as [number, number];
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    a >= 224
  );
}
/** Loopback, private, link-local, carrier-grade NAT and multicast addresses. */
export function isPrivateAddress(ip: string) {
  if (isIP(ip) === 4) return privateV4(ip);
  const lower = ip.toLowerCase();
  const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return privateV4(mapped[1]!);
  return (
    lower === "::" ||
    lower === "::1" ||
    lower.startsWith("fc") ||
    lower.startsWith("fd") ||
    lower.startsWith("fe8") ||
    lower.startsWith("fe9") ||
    lower.startsWith("fea") ||
    lower.startsWith("feb") ||
    lower.startsWith("ff")
  );
}

/**
 * Refuses URLs that aren't http(s) or that point into the local network,
 * unless an admin allowed private webhooks. Checked on save and on send,
 * since DNS can change in between.
 */
export async function assertWebhookUrl(url: string, allowPrivate: boolean) {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new SetupError(422, "INVALID_WEBHOOK", "Enter a full webhook URL.");
  }
  if (!["http:", "https:"].includes(parsed.protocol))
    throw new SetupError(
      422,
      "INVALID_WEBHOOK",
      "Webhooks must use http or https.",
    );
  if (parsed.username || parsed.password)
    throw new SetupError(
      422,
      "INVALID_WEBHOOK",
      "Put credentials in the receiving tool, not in the webhook URL.",
    );
  if (allowPrivate) return;
  const host = parsed.hostname.replace(/^\[|\]$/g, "");
  const addresses = isIP(host)
    ? [host]
    : await lookup(host, { all: true, verbatim: true })
        .then((rows) => rows.map((row) => row.address))
        .catch(() => {
          throw new SetupError(
            422,
            "INVALID_WEBHOOK",
            "Yuzu couldn't find that webhook's host.",
          );
        });
  if (!addresses.length || addresses.some(isPrivateAddress))
    throw new SetupError(
      422,
      "PRIVATE_WEBHOOK",
      "That webhook points to a local or private network address. An admin can allow private webhooks in settings.",
    );
}

export type DeliveryOutcome =
  | { status: "DELIVERED" }
  | { status: "RETRY" }
  | { status: "FAILED"; ruleId: string; runId: string; message: string };

/** Sends due deliveries once each; returns the ones that gave up for good. */
export async function deliverWebhooks(limit = 20) {
  const due = await db().automationDelivery.findMany({
    where: { status: "PENDING", nextAttemptAt: { lte: new Date() } },
    include: { rule: { select: { webhookSecret: true } } },
    orderBy: { nextAttemptAt: "asc" },
    take: limit,
  });
  if (!due.length) return [];
  const settings = await db().installationSettings.findUnique({
    where: { id: "installation" },
  });
  const failed: Extract<DeliveryOutcome, { status: "FAILED" }>[] = [];
  for (const delivery of due) {
    const attempts = delivery.attempts + 1;
    const body = JSON.stringify(delivery.payload);
    const started = Date.now();
    let responseCode: number | null = null;
    let error: string | null = null;
    try {
      await assertWebhookUrl(
        delivery.url,
        Boolean(settings?.allowPrivateWebhooks),
      );
      if (!delivery.rule.webhookSecret)
        throw new SetupError(
          409,
          "NO_SECRET",
          "This rule has no signing secret.",
        );
      let secret: string;
      try {
        secret = decryptSettings<string>(delivery.rule.webhookSecret);
      } catch {
        throw new SetupError(
          409,
          "SECRET_UNREADABLE",
          "The signing secret couldn't be read (the encryption key changed). Save the rule again to get a new secret.",
        );
      }
      const response = await fetch(delivery.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "Yuzu-Webhooks/1",
          "X-Yuzu-Delivery": delivery.id,
          "X-Yuzu-Signature": signWebhook(secret, body),
        },
        body,
        redirect: "manual",
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      responseCode = response.status;
      if (!response.ok)
        error =
          response.status >= 300 && response.status < 400
            ? `The receiver redirected (${response.status}); webhooks don't follow redirects.`
            : `The receiver answered ${response.status}.`;
    } catch (caught) {
      error =
        caught instanceof SetupError
          ? caught.message
          : caught instanceof Error && caught.name === "TimeoutError"
            ? "The receiver didn't answer within 10 seconds."
            : `Yuzu couldn't reach the receiver${networkCode(caught)}.`;
    }
    const durationMs = Date.now() - started;
    if (!error) {
      await db().automationDelivery.update({
        where: { id: delivery.id },
        data: {
          status: "DELIVERED",
          attempts,
          responseCode,
          durationMs,
          error: null,
        },
      });
      continue;
    }
    const retry = attempts <= RETRY_DELAYS.length;
    await db().automationDelivery.update({
      where: { id: delivery.id },
      data: {
        status: retry ? "PENDING" : "FAILED",
        attempts,
        responseCode,
        durationMs,
        error,
        ...(retry
          ? {
              nextAttemptAt: new Date(Date.now() + RETRY_DELAYS[attempts - 1]!),
            }
          : {}),
      },
    });
    if (!retry)
      failed.push({
        status: "FAILED",
        ruleId: delivery.ruleId,
        runId: delivery.runId,
        message: `Webhook failed after ${attempts} attempts: ${error}`,
      });
  }
  return failed;
}

/** " (ECONNREFUSED)" and the like, when the network error says why. */
function networkCode(error: unknown) {
  const code = (error as { cause?: { code?: unknown } } | null)?.cause?.code;
  return typeof code === "string" ? ` (${code})` : "";
}
