import { describe, expect, it } from "vitest";
import { resolveRecordConfig } from "./record-types";
import {
  LINK_IMPORT_TARGET,
  importTargets,
  mapImportRow,
  suggestImportMapping,
  type ImportContext,
} from "./csv-import";
import { csvHeaders, csvLine, csvTaskCells, type CsvTask } from "./csv-export";

const context = (type: "COMPANY" | "CONTACT"): ImportContext => ({
  record: { ...resolveRecordConfig(type, {}), type },
  fields: [],
  groups: [],
  people: [{ id: "user-1", name: "Rae Kim" }],
});
const boardId = "0199c7a0-0000-7000-8000-000000000001";
let next = 0;
const makeId = () =>
  `0199c7a0-0000-7000-8000-${String(++next).padStart(12, "0")}`;

describe("CRM CSV import", () => {
  it("maps a company export's headers back to its fields", () => {
    const headers = [
      "Company ID",
      "Company",
      "Domain",
      "Legal name",
      "Website",
      "Main email",
      "Main phone",
      "Address",
      "Owner",
      "Notes",
      "People (read-only)",
    ];
    const mapping = suggestImportMapping(headers, context("COMPANY"));
    expect(mapping.map((item) => item.target)).toEqual([
      "source_id",
      "name",
      "domain",
      "legal_name",
      "website",
      "email",
      "phone",
      "address",
      "assignees",
      "description",
      LINK_IMPORT_TARGET,
    ]);
    expect(
      importTargets(context("COMPANY")).some((target) => target.id === "group"),
    ).toBe(false);
  });

  it("validates and normalizes profile fields like the app does", () => {
    const company = context("COMPANY");
    const mapping = [
      { column: 0, target: "name" },
      { column: 1, target: "domain" },
      { column: 2, target: "email" },
      { column: 3, target: "assignees" },
    ];
    const good = mapImportRow(
      ["Northwind", "North.EXAMPLE", "Sales@North.Example", "Rae Kim"],
      mapping,
      company,
      boardId,
      makeId,
    );
    expect(good.issues).toEqual([]);
    expect(good.input).toMatchObject({
      name: "Northwind",
      domain: "north.example",
      email: "Sales@north.example",
      assigneeIds: ["user-1"],
    });
    const bad = mapImportRow(
      ["Bluebird", "https://bluebird.example/x", "not-an-email", ""],
      mapping,
      company,
      boardId,
      makeId,
    );
    expect(bad.issues).toEqual([
      "Domain: Enter just the domain, like example.com.",
      "Main email: Enter an email like name@company.com.",
    ]);
  });

  it("flags link columns instead of dropping them, and keeps contacts to their fields", () => {
    const contact = context("CONTACT");
    const row = mapImportRow(
      ["Ana", "Northwind (Head of operations, Current, Primary)"],
      [
        { column: 0, target: "name" },
        { column: 1, target: LINK_IMPORT_TARGET },
      ],
      contact,
      boardId,
      makeId,
    );
    expect(row.issues[0]).toMatch(/can't be imported yet\. Unmap this column/);
    expect(importTargets(contact).map((target) => target.id)).not.toContain(
      "domain",
    );
  });
});

describe("CRM CSV export", () => {
  const task: CsvTask = {
    id: "0199c7a0-0000-7000-8000-000000000009",
    name: '=HYPERLINK("http://evil.example")',
    description: "+1 call back",
    statusId: null,
    priority: "NORMAL",
    startDate: null,
    dueDate: null,
    groupId: null,
    archivedAt: null,
    revision: 3,
    createdByName: "Rae Kim",
    assigneeIds: ["user-1"],
    checklist: [],
    fieldValues: {},
    profile: { email: "ana@north.example", phone: "-555" },
    links: "@Northwind (Owner, Current, Primary); Private company",
    primaryCompany: "@Northwind",
  };

  it("writes contact columns with read-only link summaries", () => {
    const record = resolveRecordConfig("CONTACT", {});
    expect(csvHeaders([], record, "CONTACT")).toEqual([
      "Contact ID",
      "Contact",
      "Email",
      "Phone",
      "Owner",
      "Owner IDs",
      "Notes",
      "Companies (read-only)",
      "Primary company (read-only)",
      "Archived at",
      "Revision",
      "Created by",
    ]);
    const cells = csvTaskCells(task, {
      record,
      crmType: "CONTACT",
      fields: [],
      groups: [],
      people: [{ id: "user-1", name: "Rae Kim" }],
    });
    expect(cells.slice(2, 9)).toEqual([
      "ana@north.example",
      "-555",
      '["Rae Kim"]',
      '["user-1"]',
      "+1 call back",
      "@Northwind (Owner, Current, Primary); Private company",
      "@Northwind",
    ]);
    // Every text cell is neutralized against spreadsheet formulas.
    const line = csvLine(cells);
    expect(line).toContain(`"'=HYPERLINK(""http://evil.example"")"`);
    expect(line).toContain(
      `"'@Northwind (Owner, Current, Primary); Private company"`,
    );
    expect(line).toContain(`"'+1 call back"`);
    expect(line).toContain(`"'-555"`);
  });
});
