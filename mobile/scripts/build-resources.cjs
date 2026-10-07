const assert = require("node:assert/strict");
const { availableParallelism } = require("node:os");

function buildResources(options) {
    const fresh = options.clean || options.reproduceFrom || options.distribution === "fdroid";
    const accelerated = !fresh || options.jobs !== undefined || options.heap !== undefined;
    const jobs = accelerated ? (options.jobs === undefined || options.jobs === "auto" ? availableParallelism() : Number(options.jobs)) : 2;
    assert.ok(Number.isSafeInteger(jobs) && jobs > 0, "--jobs requires a positive integer or auto.");
    const heap = options.heap === undefined ? undefined : Number(options.heap);
    assert.ok(heap === undefined || (Number.isSafeInteger(heap) && heap > 0), "--heap requires a positive number of MiB.");
    return { fresh: Boolean(fresh), accelerated, jobs, jvmArguments: accelerated ? `${heap ? `-Xmx${heap}m ` : ""}-Dfile.encoding=UTF-8` : undefined };
}

module.exports = { buildResources };
