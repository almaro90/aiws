const snapshotPath = "docs/contracts/openapi.yaml";
const source = await Bun.file(snapshotPath).text();

let document: unknown;
try {
  document = Bun.YAML.parse(source);
} catch (error) {
  console.error(`Invalid OpenAPI YAML: ${error instanceof Error ? error.message : "parse failed"}`);
  process.exit(1);
}

if (!isRecord(document)) fail("OpenAPI snapshot must be an object.");
if (document.openapi !== "3.1.0") fail("OpenAPI version must be 3.1.0.");
if (!isRecord(document.info)) fail("OpenAPI info metadata is required.");
if (document.info.title !== "AIWS API") fail("OpenAPI title must be AIWS API.");
if (document.info.version !== "0.5.1") fail("OpenAPI info.version must be 0.5.1.");
if (!isRecord(document.paths) || Object.keys(document.paths).length === 0) {
  fail("OpenAPI paths must not be empty.");
}
if (!isRecord(document.components)) fail("OpenAPI components are required.");

const operationIds = new Set<string>();
for (const pathItem of Object.values(document.paths)) {
  if (!isRecord(pathItem)) continue;
  for (const operation of Object.values(pathItem)) {
    if (!isRecord(operation) || typeof operation.operationId !== "string") continue;
    if (operationIds.has(operation.operationId)) {
      fail(`Duplicate OpenAPI operationId: ${operation.operationId}.`);
    }
    operationIds.add(operation.operationId);
  }
}
if (operationIds.size === 0) fail("OpenAPI snapshot must define operationIds.");

console.log(`OpenAPI snapshot valid (${operationIds.size} operations).`);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}
