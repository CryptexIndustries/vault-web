/**
 * Starts the SSH key worker. Kept apart from ssh-key.ts because bundlers
 * (Next and the extension's Vite build) need this exact `new Worker(new URL(...))`
 * form to emit the worker chunk, and Jest can't compile `import.meta`.
 */
export const createSSHKeyWorker = () =>
    new Worker(new URL("../workers/ssh-key.worker.ts", import.meta.url), {
        type: "module",
        name: "ssh-key",
    });
