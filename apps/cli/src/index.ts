#!/usr/bin/env bun
import { runCli } from "./program.ts";

if (import.meta.main) process.exitCode = await runCli(process.argv);

export { createProgram, runCli } from "./program.ts";
