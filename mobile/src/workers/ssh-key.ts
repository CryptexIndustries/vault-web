// Bundled as plain JavaScript for the isolated Hermes worker, not imported by RN.
import "./polyfills";
import {
    runSSHKeyTask,
    type SSHKeyTask,
    type SSHKeyTaskResult,
} from "@cryptex-industries/vault-core/vault-utils/ssh-key-task";

// Worker runtimes have no crypto.getRandomValues. Imports don't need it, and
// exports bring their random bytes in the task, so nothing here supplies it:
// any other use fails as "internal" instead of using weaker randomness.
function runSSHKeyWorkerTask(task: SSHKeyTask): SSHKeyTaskResult {
    return runSSHKeyTask(task);
}

Object.assign(globalThis, { runSSHKeyWorkerTask });
