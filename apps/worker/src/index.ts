import { config } from "dotenv";
import { createServer } from "node:http";
import { startCsvWorker } from "../../web/src/server/csv-worker";
import { startAutomationWorker } from "../../web/src/server/automation-service";

config({ path: new URL("../../../.env", import.meta.url), quiet: true });
const worker = await startCsvWorker();
const automation = startAutomationWorker();
const health = createServer(async (_request, response) => {
  try {
    await worker.boss.getQueue("yuzu-csv");
    response.writeHead(200).end("worker");
  } catch {
    response.writeHead(503).end();
  }
});
health.listen(Number(process.env.WORKER_PORT ?? 3002), "0.0.0.0");
console.log("Yuzu CSV worker ready.");
console.log("Yuzu automation worker ready.");
for (const signal of ["SIGTERM", "SIGINT"])
  process.once(signal, () => {
    health.close();
    void Promise.all([worker.close(), automation.close()]).then(() =>
      process.exit(0),
    );
  });
