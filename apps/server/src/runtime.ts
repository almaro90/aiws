export interface StoppableServer {
  stop(closeActiveConnections?: boolean): Promise<void> | void;
}

export async function shutdownServer(
  server: StoppableServer,
  closeResources: () => Promise<void>,
  timeoutMs: number,
): Promise<void> {
  const gracefulStop = Promise.resolve(server.stop(false)).then(() => true);
  const completed = await Promise.race([
    gracefulStop,
    new Promise<false>((resolve) => setTimeout(() => resolve(false), timeoutMs)),
  ]);
  if (!completed) await server.stop(true);
  await closeResources();
}
