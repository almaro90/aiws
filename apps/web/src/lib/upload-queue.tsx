import { useQueryClient } from "@tanstack/react-query";
import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from "react";
import { api } from "./api.ts";

export type UploadStatus = "pending" | "uploading" | "uploaded" | "failed";

export interface UploadEntry {
  readonly file: File;
  readonly status: UploadStatus;
  readonly error?: string;
}

export interface UploadJob {
  readonly taskId: string;
  readonly entries: readonly UploadEntry[];
  readonly running: boolean;
}

interface UploadQueueValue {
  readonly jobs: ReadonlyMap<string, UploadJob>;
  readonly start: (taskId: string, version: number, files: readonly File[]) => void;
  readonly retryFailed: (taskId: string, version: number) => void;
  readonly clear: (taskId: string) => void;
}

const UploadQueueContext = createContext<UploadQueueValue | null>(null);

export function UploadQueueProvider({ children }: { readonly children: ReactNode }) {
  const client = useQueryClient();
  const [jobs, setJobs] = useState<ReadonlyMap<string, UploadJob>>(new Map());

  const run = useCallback(
    async (taskId: string, version: number, initialEntries: readonly UploadEntry[]) => {
      let currentVersion = version;
      let entries = [...initialEntries];
      const publish = (running: boolean) =>
        setJobs((current) => {
          const next = new Map(current);
          next.set(taskId, { taskId, entries, running });
          return next;
        });
      publish(true);
      for (let index = 0; index < entries.length; index += 1) {
        const entry = entries[index];
        if (!entry || entry.status === "uploaded") continue;
        entries = entries.map((item, itemIndex) =>
          itemIndex === index ? { file: item.file, status: "uploading" as const } : item,
        );
        publish(true);
        try {
          const result = await api.uploadAttachment(taskId, entry.file, currentVersion);
          currentVersion = result.taskVersion;
          entries = entries.map((item, itemIndex) =>
            itemIndex === index ? { file: item.file, status: "uploaded" as const } : item,
          );
        } catch (error) {
          entries = entries.map((item, itemIndex) =>
            itemIndex === index
              ? {
                  ...item,
                  status: "failed" as const,
                  error: error instanceof Error ? error.message : "No se pudo subir.",
                }
              : item,
          );
        }
        publish(true);
      }
      publish(false);
      await client.invalidateQueries({ queryKey: ["task", taskId] });
    },
    [client],
  );

  const start = useCallback(
    (taskId: string, version: number, files: readonly File[]) => {
      void run(
        taskId,
        version,
        files.map((file) => ({ file, status: "pending" as const })),
      );
    },
    [run],
  );

  const retryFailed = useCallback(
    (taskId: string, version: number) => {
      const job = jobs.get(taskId);
      if (!job || job.running) return;
      void run(
        taskId,
        version,
        job.entries
          .filter((entry) => entry.status === "failed")
          .map((entry) => ({ file: entry.file, status: "pending" as const })),
      );
    },
    [jobs, run],
  );

  const clear = useCallback(
    (taskId: string) =>
      setJobs((current) => {
        const next = new Map(current);
        next.delete(taskId);
        return next;
      }),
    [],
  );

  const value = useMemo(
    () => ({ jobs, start, retryFailed, clear }),
    [jobs, start, retryFailed, clear],
  );
  return <UploadQueueContext.Provider value={value}>{children}</UploadQueueContext.Provider>;
}

export function useUploadQueue(): UploadQueueValue {
  const context = useContext(UploadQueueContext);
  if (!context) throw new Error("UploadQueueProvider is missing.");
  return context;
}
