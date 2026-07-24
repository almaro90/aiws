import { describe, expect, test } from "bun:test";
import { validateArchitecture, type PackageDescription } from "../architecture.ts";

const validGraph: PackageDescription[] = [
  { name: "@aiws/core", dependencies: [], imports: [] },
  { name: "@aiws/contracts", dependencies: ["@aiws/core"], imports: ["@aiws/core"] },
  { name: "@aiws/sqlite", dependencies: ["@aiws/core"], imports: ["@aiws/core"] },
  {
    name: "@aiws/api-client",
    dependencies: ["@aiws/contracts"],
    imports: ["@aiws/contracts"],
  },
  {
    name: "@aiws/server",
    dependencies: ["@aiws/core", "@aiws/contracts", "@aiws/sqlite"],
    imports: ["@aiws/core"],
  },
  { name: "@aiws/web", dependencies: ["@aiws/api-client"], imports: [] },
  { name: "@aiws/cli", dependencies: ["@aiws/api-client"], imports: [] },
];

describe("architecture graph", () => {
  test("accepts the documented graph", () => {
    expect(validateArchitecture(validGraph)).toEqual([]);
  });

  test("rejects a cycle", () => {
    const graph = structuredClone(validGraph);
    graph.find(({ name }) => name === "@aiws/core")?.dependencies.push("@aiws/contracts");

    expect(validateArchitecture(graph).some((error) => error.includes("cycle"))).toBe(true);
  });

  test("rejects a prohibited import", () => {
    const graph = structuredClone(validGraph);
    const web = graph.find(({ name }) => name === "@aiws/web");
    web?.imports.push("@aiws/core");
    web?.dependencies.push("@aiws/core");

    expect(validateArchitecture(graph)).toContain("@aiws/web has prohibited import @aiws/core.");
  });
});
