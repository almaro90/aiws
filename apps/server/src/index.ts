import { loadConfig } from "./config.ts";
import { composeServer } from "./composition/server.ts";
import { runServerCommand } from "./commands.ts";
import { shutdownServer } from "./runtime.ts";

export { ConfigError, loadConfig } from "./config.ts";
export type { Config, NonProductionConfig, ProductionConfig } from "./config.ts";
export { createApp, type AppOptions } from "./http/app.ts";
export { composeServer } from "./composition/server.ts";
export { RepositoryValidator } from "./repositories/repository-validator.ts";
export { JsonLogger, type LogEntry, type Logger } from "./logging/logger.ts";
export { runServerCommand } from "./commands.ts";
export { shutdownServer, type StoppableServer } from "./runtime.ts";

if (import.meta.main) {
  const commandResult = await runServerCommand(process.argv);
  if (commandResult !== null) {
    process.exitCode = commandResult;
  } else {
    const config = loadConfig(Bun.env);
    const { app, unitOfWork, notificationDispatcher } = await composeServer(config);
    const server = Bun.serve({ hostname: config.host, port: config.port, fetch: app.fetch });
    notificationDispatcher.start();
    let shutdownStarted = false;
    const shutdown = (): void => {
      if (shutdownStarted) return;
      shutdownStarted = true;
      void shutdownServer(
        server,
        async () => {
          await notificationDispatcher.stop();
          await unitOfWork.close();
        },
        config.gracefulShutdownMs,
      ).catch((error) => {
        console.error(error instanceof Error ? error.message : "Graceful shutdown failed.");
        process.exitCode = 1;
      });
    };
    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
  }
}
