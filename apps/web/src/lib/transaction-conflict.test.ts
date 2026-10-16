import { expect, it } from "vitest";
import { isTransactionConflict } from "./transaction-conflict";

it.each([
  { code: "P2034" },
  { code: "P2002" },
  {
    name: "DriverAdapterError",
    cause: { originalCode: "40001", kind: "TransactionWriteConflict" },
  },
  { code: "P2010", meta: { code: "40001" } },
  { code: "P2010", meta: { code: "40P01" } },
  {
    code: "P2010",
    meta: {
      driverAdapterError: {
        cause: { originalCode: "40001", kind: "TransactionWriteConflict" },
      },
    },
  },
  {
    code: "P2010",
    meta: {
      driverAdapterError: { cause: { kind: "TransactionWriteConflict" } },
    },
  },
])("retries actual transaction conflicts: %j", (error) =>
  expect(isTransactionConflict(error)).toBe(true),
);
it.each([
  null,
  undefined,
  "40001",
  { code: "P2010" },
  { code: "P2010", meta: { code: "42601" } },
  { code: "P2010", meta: { code: "23503" } },
  { code: "P2028" },
  { message: "40001" },
  {
    name: "DriverAdapterError",
    cause: { originalCode: "42601", kind: "SyntaxError" },
  },
])("does not retry unrelated errors: %j", (error) =>
  expect(isTransactionConflict(error)).toBe(false),
);
