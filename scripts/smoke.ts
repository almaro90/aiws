import { loadConfig } from "@aiws/server";
import { UlidIdGenerator } from "@aiws/core";

const packageNames = [
  "@aiws/server",
  "@aiws/web",
  "@aiws/cli",
  "@aiws/core",
  "@aiws/contracts",
  "@aiws/sqlite",
  "@aiws/api-client",
] as const;

for (const packageName of packageNames) await import(packageName);

const config = loadConfig({ AIWS_ENV: "test" });
if (config.env !== "test" || config.port !== 3000) throw new Error("Configuration smoke failed.");

const id = new UlidIdGenerator().taskId();
if (!/^tsk_[0-9A-HJKMNP-TV-Z]{26}$/.test(id)) throw new Error("ID smoke failed.");

console.log(`Smoke passed (${packageNames.length} export maps, config, IDs).`);
