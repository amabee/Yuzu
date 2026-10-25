import { describe, expect, it } from "vitest";
import {
  crmRecordHref,
  normalizeDomain,
  profileChangesSchema,
  profileSchemas,
} from "./crm-contract";
import { updateTaskSchema } from "./board-contract";

const parse = (values: Record<string, unknown>) =>
  profileChangesSchema.safeParse(values);

describe("CRM profile fields", () => {
  it("turns blank optional text into null and trims the rest", () => {
    expect(
      parse({ legalName: "  ", phone: " +63 917 555 0142 " }).data,
    ).toEqual({ legalName: null, phone: "+63 917 555 0142" });
    expect(parse({ email: null }).data).toEqual({ email: null });
  });

  it("checks email syntax and length, lowercasing only the domain", () => {
    expect(parse({ email: "Ana.Reyes+crm@North.EXAMPLE" }).data).toEqual({
      email: "Ana.Reyes+crm@north.example",
    });
    expect(parse({ email: "ana@" }).success).toBe(false);
    expect(parse({ email: `${"a".repeat(246)}@north.io` }).success).toBe(false);
  });

  it("accepts web addresses only with http(s) and no sign-in details", () => {
    expect(parse({ website: "https://north.example/about" }).success).toBe(
      true,
    );
    for (const website of [
      "north.example",
      "javascript:alert(1)",
      "ftp://north.example",
      "https://ana:pw@north.example",
      `https://north.example/${"a".repeat(2048)}`,
    ])
      expect(parse({ website }).success, website).toBe(false);
  });

  it("normalizes domains to lowercase ASCII hostnames", () => {
    expect(normalizeDomain("Bücher.Example.")).toBe("xn--bcher-kva.example");
    expect(normalizeDomain("sub.North.example")).toBe("sub.north.example");
    for (const value of [
      "https://north.example",
      "north.example/path",
      "north.example:8080",
      "*.north.example",
      "localhost",
      "10.0.0.1",
      "-bad.example",
      "a b.example",
    ])
      expect(normalizeDomain(value), value).toBeNull();
    expect(parse({ domain: "WWW.North.example" }).data).toEqual({
      domain: "www.north.example",
    });
  });

  it("rejects control characters, allowing line breaks only in addresses", () => {
    expect(parse({ phone: "+63\u0000917" }).success).toBe(false);
    expect(parse({ phone: "+63\n917" }).success).toBe(false);
    expect(parse({ address: "12 Ayala Ave\nMakati" }).success).toBe(true);
    expect(profileSchemas.address.safeParse("x".repeat(1001)).success).toBe(
      false,
    );
  });

  it("rides along with ordinary record changes", () => {
    expect(
      updateTaskSchema.parse({
        taskId: "0199c7a0-0000-7000-8000-000000000001",
        revision: 1,
        changes: { domain: "North.example" },
      }).changes,
    ).toEqual({ domain: "north.example" });
  });

  it("links records to their CRM screen", () => {
    expect(crmRecordHref("COMPANY")).toBe("/crm/companies");
    expect(crmRecordHref("CONTACT", "abc")).toBe("/crm/contacts?record=abc");
  });
});
