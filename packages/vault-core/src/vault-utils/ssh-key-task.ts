/**
 * The slow SSH key operations as one plain-data function, so web and the
 * extension can run it in a Web Worker and Android on a worklet runtime.
 * Tasks and results hold only strings, so they cross any message boundary.
 */
import { base64ToUint8 } from "../encoding";
import type { SSHKeyData } from "../proto/vault";
import {
    exportSSHPrivateKey,
    importSSHPrivateKeySync,
    SSHKeyError,
    type SSHKeyErrorCode,
    type SSHKeyErrorParams,
} from "./ssh-key";
import { SSH_KEY_TASK_INTERNAL_ERROR } from "./ssh-key-info";

export type SSHKeyTask =
    | {
          kind: "import";
          text: string;
          passphrase?: string;
          /** Contents of the matching .pub file. */
          publicKey?: string;
      }
    | {
          kind: "export";
          data: SSHKeyData;
          passphrase?: string;
          /**
           * Base64 of SSH_EXPORT_RANDOM_BYTES secure random bytes. Pass it
           * when the worker runtime has no crypto.getRandomValues.
           */
          random?: string;
      };

export type SSHKeyTaskResult =
    | { ok: true; kind: "import"; data: SSHKeyData }
    | { ok: true; kind: "export"; text: string }
    | {
          ok: false;
          /** "internal" is a bug or a broken worker, not a problem with the key. */
          code: SSHKeyErrorCode | "internal";
          message: string;
          params?: SSHKeyErrorParams;
      };

export { SSH_KEY_TASK_INTERNAL_ERROR };

/** Runs a task synchronously. Never throws. */
export const runSSHKeyTask = (task: SSHKeyTask): SSHKeyTaskResult => {
    try {
        if (task.kind === "import") {
            const result = importSSHPrivateKeySync(task.text, {
                passphrase: task.passphrase,
                publicKey: task.publicKey,
            });
            return result.isOk()
                ? { ok: true, kind: "import", data: copyData(result.value) }
                : {
                      ok: false,
                      code: result.error.code,
                      message: result.error.message,
                      params: result.error.params,
                  };
        }
        return {
            ok: true,
            kind: "export",
            text: exportSSHPrivateKey(
                task.data,
                task.passphrase,
                task.random === undefined
                    ? undefined
                    : base64ToUint8(task.random),
            ),
        };
    } catch (error) {
        if (error instanceof SSHKeyError) {
            return {
                ok: false,
                code: error.code,
                message: error.message,
                params: error.params,
            };
        }
        return {
            ok: false,
            code: "internal",
            message: SSH_KEY_TASK_INTERNAL_ERROR,
        };
    }
};

const copyData = (data: SSHKeyData): SSHKeyData => ({
    PrivateKey: data.PrivateKey,
    PublicKey: data.PublicKey,
    Comment: data.Comment,
});
