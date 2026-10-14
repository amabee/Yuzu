import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

export class SetupError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
export const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export function matchesSecret(input: string, expected: string) {
  return timingSafeEqual(
    Buffer.from(digest(input), "hex"),
    Buffer.from(digest(expected), "hex"),
  );
}
function encryptionKey() {
  const key = Buffer.from(
    process.env.SETTINGS_ENCRYPTION_KEY ?? "",
    "base64url",
  );
  if (key.length !== 32)
    throw new SetupError(
      503,
      "CONFIGURATION_REQUIRED",
      "Installation encryption keys are not configured.",
    );
  return key;
}
export function encryptSettings(value: unknown) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const content = Buffer.concat([
    cipher.update(JSON.stringify(value), "utf8"),
    cipher.final(),
  ]);
  return [iv, cipher.getAuthTag(), content]
    .map((part) => part.toString("base64url"))
    .join(".");
}
export function decryptSettings<T>(value: string): T {
  const [iv, tag, content] = value
    .split(".")
    .map((part) => Buffer.from(part, "base64url"));
  const cipher = createDecipheriv("aes-256-gcm", encryptionKey(), iv);
  cipher.setAuthTag(tag);
  return JSON.parse(
    Buffer.concat([cipher.update(content), cipher.final()]).toString("utf8"),
  ) as T;
}
export function configuredOrigin() {
  const url = process.env.BETTER_AUTH_URL;
  if (!url)
    throw new SetupError(
      503,
      "CONFIGURATION_REQUIRED",
      "The installation URL is not configured.",
    );
  return new URL(url).origin;
}

export async function readSetupBody(
  request: Request,
  maxBytes = 16_384,
): Promise<unknown> {
  if (request.headers.get("origin") !== configuredOrigin())
    throw new SetupError(
      403,
      "INVALID_ORIGIN",
      "Use the installation's configured address for this request.",
    );
  if (!request.headers.get("content-type")?.startsWith("application/json"))
    throw new SetupError(415, "JSON_REQUIRED", "Send a JSON request.");
  const reader = request.body?.getReader();
  if (!reader)
    throw new SetupError(422, "INVALID_INPUT", "The request is empty.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      throw new SetupError(413, "TOO_LARGE", "The request is too large.");
    }
    chunks.push(value);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new SetupError(
      422,
      "INVALID_INPUT",
      "The request could not be read.",
    );
  }
}
