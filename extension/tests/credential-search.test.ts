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
