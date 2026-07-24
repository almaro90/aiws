const curationQuestionSchema = {
  type: "object",
  additionalProperties: false,
  required: ["text", "type", "options", "allowOther"],
  properties: {
    text: { type: "string", minLength: 1, maxLength: 5000 },
    type: { type: "string", enum: ["text", "single_choice", "multiple_choice"] },
    options: {
      type: "array",
      maxItems: 20,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["label"],
        properties: { label: { type: "string", minLength: 1, maxLength: 500 } },
      },
    },
    allowOther: { type: "boolean" },
  },
};

export const curationOutputSchema = {
  type: "object",
  additionalProperties: false,
  required: ["outcome", "title", "curatorSpec", "questions", "summary"],
  properties: {
    outcome: { type: "string", enum: ["ready", "blocked"] },
    title: { type: ["string", "null"], minLength: 1, maxLength: 200 },
    curatorSpec: { type: ["string", "null"], maxLength: 1_048_576 },
    questions: {
      type: "array",
      minItems: 0,
      maxItems: 10,
      items: curationQuestionSchema,
    },
    summary: { type: "string", maxLength: 10_000 },
  },
};

export async function materializeCurationContext(
  workspacesDirectory: string,
  assignment: Assignment,
  downloadAttachment: (taskId: string, attachmentId: string) => Promise<Uint8Array>,
): Promise<void> {
  const runRoot = join(workspacesDirectory, "runs", assignment.run.id);
  const attachmentsDirectory = join(runRoot, "attachments");
  const controlDirectory = join(runRoot, "control");
  await mkdir(attachmentsDirectory, { recursive: true, mode: 0o700 });
  await mkdir(controlDirectory, { recursive: true, mode: 0o700 });
  for (const attachment of assignment.task.attachments) {
    const path = join(
      attachmentsDirectory,
      `${attachment.id}-${attachment.originalName.replaceAll(/[^A-Za-z0-9._-]/gu, "_").slice(0, 180)}`,
    );
    await writeFile(path, await downloadAttachment(assignment.task.id, attachment.id), {
      mode: 0o444,
    });
    await chmod(path, 0o444);
    if (attachment.mimeType === "application/pdf") {
      const extractedPath = `${path}.txt`;
      const process = Bun.spawn(["pdftotext", "-layout", path, extractedPath], {
        stdout: "ignore",
        stderr: "pipe",
      });
      if ((await process.exited) !== 0) throw new Error(`Could not extract PDF ${attachment.id}.`);
      await chmod(extractedPath, 0o444);
    }
  }
  const schemaPath = join(controlDirectory, "curation-output.schema.json");
  await writeFile(schemaPath, JSON.stringify(curationOutputSchema), { mode: 0o444 });
  await chmod(schemaPath, 0o444);
  await chmod(attachmentsDirectory, 0o555);
  await chmod(controlDirectory, 0o555);
}

export function normalizeCurationOutput(output: Record<string, unknown>): Record<string, unknown> {
  const title = nullableString(output.title, "title");
  const curatorSpec = nullableString(output.curatorSpec, "curatorSpec");
  const summary = requiredString(output.summary, "summary");
  if (!Array.isArray(output.questions)) throw new Error("Curation questions must be an array.");

  if (output.outcome === "ready") {
    if (curatorSpec === null || curatorSpec.trim() === "") {
      throw new Error("Ready curation requires a non-empty Curator Spec.");
    }
    if (output.questions.length !== 0) {
      throw new Error("Ready curation cannot include Questions.");
    }
    return {
      outcome: "ready",
      ...(title === null ? {} : { title }),
      curatorSpec,
      summary,
    };
  }

  if (output.outcome === "blocked") {
    if (output.questions.length < 1 || output.questions.length > 10) {
      throw new Error("Blocked curation requires between 1 and 10 Questions.");
    }
    return {
      outcome: "blocked",
      ...(title === null ? {} : { title }),
      ...(curatorSpec === null ? {} : { curatorSpec }),
      questions: output.questions,
      summary,
    };
  }

  throw new Error("Curation outcome must be ready or blocked.");
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string") throw new Error(`Curation ${field} must be a string.`);
  return value;
}

function nullableString(value: unknown, field: string): string | null {
  if (value !== null && typeof value !== "string") {
    throw new Error(`Curation ${field} must be a string or null.`);
  }
  return value;
}
import { chmod, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Assignment } from "./client.ts";
