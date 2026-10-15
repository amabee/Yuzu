import { createReadStream } from "node:fs";
import { fileTypeFromFile } from "file-type";
import { attachmentName, attachmentTypes } from "@/lib/attachment-contract";
import { SetupError } from "./setup/security";

export async function validateAttachment(
  path: string,
  name: string,
  declaredMime: string,
) {
  const fileName = attachmentName.parse(name);
  const extension = fileName.split(".").at(-1)?.toLowerCase();
  const expectedMime = Object.keys(attachmentTypes).find((mime) =>
    attachmentTypes[mime].includes(extension ?? ""),
  );
  const invalid = () =>
    new SetupError(
      415,
      "FILE_TYPE_NOT_ALLOWED",
      "Use an allowed file type whose name and contents match.",
    );
  if (!expectedMime) throw invalid();
  if (
    declaredMime &&
    declaredMime !== "application/octet-stream" &&
    declaredMime.split(";")[0].trim().toLowerCase() !== expectedMime
  )
    throw invalid();
  try {
    if (expectedMime.startsWith("text/")) {
      const decoder = new TextDecoder("utf-8", { fatal: true });
      let prefix = "";
      for await (const chunk of createReadStream(path)) {
        const text = decoder.decode(chunk, { stream: true });
        if (/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(text)) throw invalid();
        if (prefix.length < 4096) prefix += text.slice(0, 4096 - prefix.length);
      }
      decoder.decode();
      if (
        /^\s*(?:MZ|#!|<\?xml|<!doctype\s+html|<html\b|<svg\b|<script\b)/i.test(
          prefix,
        )
      )
        throw invalid();
    } else {
      const detected = await fileTypeFromFile(path);
      if (detected?.mime !== expectedMime) throw invalid();
    }
  } catch {
    throw invalid();
  }
  return { fileName, mimeType: expectedMime };
}
