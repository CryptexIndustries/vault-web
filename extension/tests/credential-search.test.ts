/**
 * @jest-environment node
 */
import { describe, expect, it } from "@jest/globals";
import {
    CredentialURLMatchMode,
    ItemType,
} from "@cryptex-industries/vault-core/proto";

import type { LiteCredential } from "../src/types/sw-messaging";
import { credentialMatchesSearch } from "../src/utils/credential-search";

const credential: LiteCredential = {
    id: "cred-1",
    name: "Production Admin",
    username: "alice@example.com",
    tags: "work,|.|,critical service",
    notes: "Rotated by the platform team",
    url: "https://admin.example.com",
    urlMatchMode: CredentialURLMatchMode.ExactHost,
    additionalUrls: [],
    directoryId: "",
    type: ItemType.Credentials,
};

describe("popup credential search", () => {
    it.each([
        "alice",
        "critical service",
        "platform team",
        "name:production",
        "tag:work",
        'tag:"critical service"',
        "note:platform",
        "name:admin tag:critical",
    ])("matches %s", (query) => {
        expect(credentialMatchesSearch(credential, query)).toBe(true);
    });

    it.each(["name:customer", "tag:personal", "note:finance"])(
        "rejects %s",
        (query) => {
            expect(credentialMatchesSearch(credential, query)).toBe(false);
        },
    );
});

describe("popup SSH key search", () => {
    const sshKey: LiteCredential = {
        id: "ssh-1",
        name: "Deploy key",
        username: "",
        url: "",
        urlMatchMode: CredentialURLMatchMode.ExactHost,
        additionalUrls: [],
        directoryId: "",
        type: ItemType.SSHKey,
        sshKey: {
            label: "Ed25519",
            fingerprint: "SHA256:7ObmGDWq0Pe1tXvVcOx4Y2hU3bRY8j0jRxV0xWJ6pDs",
            comment: "ci@build-server",
        },
    };

    it.each(["deploy", "build-server", "SHA256:7ObmGDWq0", "7obmgdwq"])(
        "matches %s",
        (query) => {
            expect(credentialMatchesSearch(sshKey, query)).toBe(true);
        },
    );

    it("rejects unrelated text", () => {
        expect(credentialMatchesSearch(sshKey, "laptop")).toBe(false);
    });
});
