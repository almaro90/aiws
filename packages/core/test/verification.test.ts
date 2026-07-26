import { describe, expect, test } from "bun:test";
import {
  createVerificationContractRevision,
  ValidationError,
  type ProjectId,
  type VerificationCommand,
} from "../src/index.ts";

const projectId = "prj_01K0ABCDEFGHJKMNPQRSTVWXYZ" as ProjectId;
const command: VerificationCommand = {
  name: "tests",
  executable: "bun",
  args: ["test"],
  required: true,
  timeoutSeconds: 300,
};

describe("Verification Contract domain", () => {
  test("creates an ordered active revision without shell-shaped fields", () => {
    expect(
      createVerificationContractRevision({
        projectId,
        revision: 1,
        enabled: true,
        commands: [command, { ...command, name: "lint", args: ["run", "lint"] }],
        now: "2026-07-26T10:00:00.000Z",
      }),
    ).toMatchObject({
      revision: 1,
      enabled: true,
      commands: [{ name: "tests" }, { name: "lint" }],
    });
  });

  test("rejects duplicate names, invalid argv, limits and timeout", () => {
    const invalid = [
      command,
      { ...command, name: "tests", executable: "bun\nsh", timeoutSeconds: 0 },
    ];
    expect(() =>
      createVerificationContractRevision({
        projectId,
        revision: 1,
        enabled: true,
        commands: invalid,
        now: "2026-07-26T10:00:00.000Z",
      }),
    ).toThrow(ValidationError);
    expect(() =>
      createVerificationContractRevision({
        projectId,
        revision: 1,
        enabled: true,
        commands: Array.from({ length: 21 }, (_, index) => ({
          ...command,
          name: `command-${index}`,
        })),
        now: "2026-07-26T10:00:00.000Z",
      }),
    ).toThrow(ValidationError);
    expect(() =>
      createVerificationContractRevision({
        projectId,
        revision: 1,
        enabled: true,
        commands: [{ ...command, args: ["\0secret"] }],
        now: "2026-07-26T10:00:00.000Z",
      }),
    ).toThrow(ValidationError);
  });

  test("represents disablement only as an empty append-only revision", () => {
    expect(
      createVerificationContractRevision({
        projectId,
        revision: 2,
        enabled: false,
        commands: [],
        now: "2026-07-26T10:00:00.000Z",
      }),
    ).toMatchObject({ revision: 2, enabled: false, commands: [] });
    expect(() =>
      createVerificationContractRevision({
        projectId,
        revision: 2,
        enabled: false,
        commands: [command],
        now: "2026-07-26T10:00:00.000Z",
      }),
    ).toThrow(ValidationError);
  });
});
