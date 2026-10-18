import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";

let worker: ChildProcess | undefined;
export async function startTestCsvWorker() {
  if (new URL(process.env.YUZU_E2E_DATABASE_URL!).pathname !== "/yuzu_e2e")
    throw new Error(
      "Refusing to run worker tests outside the isolated test database.",
    );
  worker = spawn(
    process.execPath,
    ["--import", "tsx", "../worker/src/index.ts"],
    {
      cwd: fileURLToPath(new URL("../", import.meta.url)),
      env: {
        ...process.env,
        TSX_TSCONFIG_PATH: fileURLToPath(
          new URL("../tsconfig.json", import.meta.url),
        ),
        DATABASE_URL: process.env.YUZU_E2E_DATABASE_URL,
        WORKER_PORT: "3102",
        // Same test-only key as the web server, so both read stored secrets.
        SETTINGS_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64url"),
        BETTER_AUTH_URL: "http://127.0.0.1:3100",
        REALTIME_SECRET: "browser-tests-only-realtime-secret-32-characters",
        REALTIME_INTERNAL_URL: "http://127.0.0.1:3101",
        YUZU_STORAGE_PROVIDER: process.env.YUZU_E2E_S3 === "1" ? "S3" : "LOCAL",
        YUZU_S3_BUCKET: "yuzu-e2e-attachments",
        YUZU_UPLOAD_DIR: fileURLToPath(
          new URL("../../../artifacts/e2e-attachments/", import.meta.url),
        ),
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  const child = worker;
  await new Promise<void>((resolve, reject) => {
    let output = "";
    const timeout = setTimeout(
      () => reject(new Error(`CSV worker did not start: ${output}`)),
      30_000,
    );
    const receive = (chunk: Buffer) => {
      output += chunk.toString();
      if (output.includes("Yuzu CSV worker ready.")) {
        clearTimeout(timeout);
        resolve();
      }
    };
    child.stdout?.on("data", receive);
    child.stderr?.on("data", receive);
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("exit", (code) => {
      clearTimeout(timeout);
      if (!output.includes("Yuzu CSV worker ready."))
        reject(new Error(`CSV worker exited ${code}: ${output}`));
    });
  });
}
export async function stopTestCsvWorker() {
  const child = worker;
  worker = undefined;
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((resolve) => {
    child.once("exit", () => resolve());
    child.kill("SIGKILL");
  });
}
