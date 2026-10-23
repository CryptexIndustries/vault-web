/** The SSH key fixtures in vault-core's tests, for the web and extension tests. */
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SSH_FIXTURES = join(
    __dirname,
    "../../../packages/vault-core/src/tests/fixtures/ssh",
);

export const sshFixture = (name: string) =>
    readFileSync(join(SSH_FIXTURES, name), "utf8");

/** The fixture's `<name>.pub` line without its comment. */
export const sshPublicKey = (name: string) =>
    sshFixture(`${name}.pub`).trim().split(/\s+/).slice(0, 2).join(" ");
