/**
 * Runs SSH key import and export off the main thread. Unlocking a key runs
 * bcrypt and parsing RSA keys is slow, which would freeze the page.
 * One task per worker: the client starts a worker, posts the task, reads
 * the result and terminates it, or terminates it early to cancel.
 */
import {
    runSSHKeyTask,
    type SSHKeyTask,
    type SSHKeyTaskResult,
} from "@cryptex-industries/vault-core/vault-utils/ssh-key-task";

const scope = globalThis as unknown as {
    onmessage: ((event: MessageEvent<SSHKeyTask>) => void) | null;
    postMessage: (result: SSHKeyTaskResult) => void;
};

scope.onmessage = (event) => {
    scope.postMessage(runSSHKeyTask(event.data));
};
