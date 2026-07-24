import { inspectWorkspaces, validateArchitecture } from "./architecture.ts";

const packages = await inspectWorkspaces(process.cwd());
const errors = validateArchitecture(packages);

if (errors.length > 0) {
  for (const error of errors) console.error(error);
  process.exit(1);
}

console.log(`Architecture graph valid (${packages.length} workspaces).`);
