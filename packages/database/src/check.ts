import { config } from "dotenv";
import { checkDatabase, getDatabase } from "./index";

config({ path: new URL("../../../.env", import.meta.url), quiet: true });
try {
  await checkDatabase();
  console.log("Database connection and foundation schema are ready.");
} catch {
  console.error(
    "Database check failed. Check local services, configuration, and migrations.",
  );
  process.exitCode = 1;
} finally {
  if (process.env.DATABASE_URL) await getDatabase().$disconnect();
}
