import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { VaultCredential } from "@cryptex-industries/vault-core/vault-utils/vault";
import type { PendingAndroidCredentialRequest } from "@/utils/android-credentials";
import {
    buildAutofillTarget,
    defaultAutofillCredentialName,
    matchingAutofillCredentials,
} from "@/utils/android-autofill";

// The iOS AutoFill extension's save screen ports these rules; its Swift tests
// read the same vectors.
const vectors = JSON.parse(
    readFileSync(
        join(
            __dirname,
            "../targets/AutofillCoreTests/Fixtures/save-vectors.json",
        ),
        "utf8",
    ),
) as {
    defaults: {
        name: string;
        source: Partial<PendingAndroidCredentialRequest>;
        expectedName: string;
        expectedUrl: string;
    }[];
    logins: Partial<VaultCredential>[];
    candidates: {
        name: string;
        source: Partial<PendingAndroidCredentialRequest> & {
            comparesPort?: boolean;
        };
        username: string;
        expectedIds: string[];
    }[];
};

const request = (source: Partial<PendingAndroidCredentialRequest>) =>
    ({
        id: "save",
        kind: "autofill-save",
        ...source,
    }) as PendingAndroidCredentialRequest;

describe("shared autofill save vectors", () => {
    it.each(vectors.defaults)(
        "$name",
        ({ source, expectedName, expectedUrl }) => {
            const target = buildAutofillTarget(request(source));
            expect(defaultAutofillCredentialName(request(source))).toBe(
                expectedName,
            );
            expect(target.pageUrl ?? target.appUri ?? "").toBe(expectedUrl);
        },
    );

    // As saveCandidates in app/credential-request.tsx. Android's webDomain
    // has no port, so the iOS vectors that compare ports don't apply.
    it.each(vectors.candidates.filter(({ source }) => !source.comparesPort))(
        "$name",
        ({ source, username, expectedIds }) => {
            const logins = vectors.logins.map((fields) =>
                Object.assign(new VaultCredential(), fields),
            );
            const candidates = username
                ? matchingAutofillCredentials(
                      logins,
                      buildAutofillTarget(request(source)),
                  ).filter((credential) => credential.Username === username)
                : [];
            expect(candidates.map(({ ID }) => ID)).toEqual(expectedIds);
        },
    );
});
