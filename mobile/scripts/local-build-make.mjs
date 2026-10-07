#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export function makeArguments(args, jobs) {
    assert.ok(Number.isSafeInteger(jobs) && jobs > 0, "Invalid native build job count.");
    return args.map(arg => /^-j\d+$/.test(arg) ? `-j${jobs}` : arg);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
    const command = process.env.CRYPTEX_LOCAL_BUILD_MAKE;
    assert.ok(command, "Missing native make command.");
    const result = spawnSync(command, makeArguments(process.argv.slice(2), Number(process.env.CRYPTEX_LOCAL_BUILD_JOBS)), { stdio: "inherit" });
    if (result.error) throw result.error;
    process.exitCode = result.status ?? 1;
}
