const object = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;

function postgresConflict(value: unknown, depth = 0): boolean {
  const details = object(value);
  if (!details || depth > 4) return false;
  if (
    [details.code, details.originalCode].some(
      (code) => code === "40001" || code === "40P01",
    ) ||
    details.kind === "TransactionWriteConflict"
  )
    return true;
  return [details.meta, details.driverAdapterError, details.cause].some(
    (cause) => postgresConflict(cause, depth + 1),
  );
}

export function isTransactionConflict(error: unknown) {
  const details = object(error);
  if (!details) return false;
  return (
    details.code === "P2034" ||
    details.code === "P2002" ||
    (details.code === "P2010" && postgresConflict(details.meta)) ||
    (details.name === "DriverAdapterError" && postgresConflict(details.cause))
  );
}
