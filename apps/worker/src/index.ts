import { config } from "dotenv";
import { createServer } from "node:http";
import { startCsvWorker } from "../../web/src/server/csv-worker";

config({ path: new URL("../../../.env", import.meta.url), quiet: true });
const worker = await startCsvWorker();
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
for (const signal of ["SIGTERM", "SIGINT"])
  process.once(signal, () => {
    health.close();
    void worker.close().then(() => process.exit(0));
  });
