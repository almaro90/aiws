import { readFile, readdir } from "node:fs/promises";
import { join, relative } from "node:path";

export const INTERNAL_DEPENDENCIES = {
  "@aiws/server": ["@aiws/core", "@aiws/contracts", "@aiws/sqlite"],
  "@aiws/web": ["@aiws/api-client"],
  "@aiws/cli": ["@aiws/api-client"],
  "@aiws/core": [],
  "@aiws/contracts": ["@aiws/core"],
  "@aiws/sqlite": ["@aiws/core"],
  "@aiws/api-client": ["@aiws/contracts"],
  "@aiws/runner": [],
} as const;

export type InternalPackageName = keyof typeof INTERNAL_DEPENDENCIES;

export interface PackageDescription {
  name: string;
  dependencies: string[];
  imports: string[];
  location?: string;
}

export function validateArchitecture(packages: PackageDescription[]): string[] {
  const errors: string[] = [];
  const internalNames = new Set(Object.keys(INTERNAL_DEPENDENCIES));
  const packagesByName = new Map(packages.map((item) => [item.name, item]));

  for (const packageDescription of packages) {
    if (!internalNames.has(packageDescription.name)) {
      errors.push(`Unknown internal package ${packageDescription.name}.`);
      continue;
    }
    const allowed = new Set(INTERNAL_DEPENDENCIES[packageDescription.name as InternalPackageName]);
    for (const dependency of packageDescription.dependencies.filter((name) =>
      internalNames.has(name),
    )) {
      if (!allowed.has(dependency as never)) {
        errors.push(`${packageDescription.name} has prohibited dependency ${dependency}.`);
      }
    }
    for (const imported of packageDescription.imports.filter((name) => internalNames.has(name))) {
      if (!allowed.has(imported as never)) {
        errors.push(`${packageDescription.name} has prohibited import ${imported}.`);
      }
      if (!packageDescription.dependencies.includes(imported)) {
        errors.push(`${packageDescription.name} imports undeclared dependency ${imported}.`);
      }
    }
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const path: string[] = [];

  const visit = (name: string): void => {
    if (visiting.has(name)) {
      const start = path.indexOf(name);
      errors.push(`Internal dependency cycle: ${[...path.slice(start), name].join(" -> ")}.`);
      return;
    }
    if (visited.has(name)) return;
    visiting.add(name);
    path.push(name);
    const current = packagesByName.get(name);
    for (const dependency of current?.dependencies ?? []) {
      if (packagesByName.has(dependency)) visit(dependency);
    }
    path.pop();
    visiting.delete(name);
    visited.add(name);
  };

  for (const name of packagesByName.keys()) visit(name);
  return [...new Set(errors)];
}

export async function inspectWorkspaces(root: string): Promise<PackageDescription[]> {
  const locations = ["apps", "packages"];
  const descriptions: PackageDescription[] = [];

  for (const parent of locations) {
    const entries = await readdir(join(root, parent), { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const location = join(root, parent, entry.name);
      const manifest = (await Bun.file(join(location, "package.json")).json()) as {
        name: string;
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
        peerDependencies?: Record<string, string>;
      };
      descriptions.push({
        name: manifest.name,
        dependencies: Object.keys({
          ...manifest.dependencies,
          ...manifest.devDependencies,
          ...manifest.peerDependencies,
        }),
        imports: await findInternalImports(location),
        location: relative(root, location),
      });
    }
  }
  return descriptions;
}

async function findInternalImports(location: string): Promise<string[]> {
  const files = await readdir(location, { recursive: true, withFileTypes: true });
  const imports = new Set<string>();
  for (const file of files) {
    if (!file.isFile() || !/\.(?:ts|tsx)$/.test(file.name)) continue;
    const path = join(file.parentPath, file.name);
    if (path.includes("/dist/") || path.includes("/node_modules/")) continue;
    const source = await readFile(path, "utf8");
    for (const match of source.matchAll(/(?:from\s+|import\s*(?:\(\s*)?)["'](@aiws\/[^/"']+)/g)) {
      const name = match[1];
      if (name) imports.add(name);
    }
  }
  return [...imports];
}
