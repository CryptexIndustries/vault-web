/**
 * @jest-environment node
 */
import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import {
    CredentialURLMatchMode,
    CustomFieldType,
    ItemType,
} from "@cryptex-industries/vault-core/proto";
import * as VaultUtilTypes from "@cryptex-industries/vault-core/proto";
import type { CredentialFormSchemaType } from "@cryptex-industries/vault-core/vault-utils/vault";
import type { CredentialDraft } from "../src/types/sw-messaging";
import {
    clearCredentialDraft,
    getCredentialDraft,
    isCredentialDraft,
    normalizeDraftForm,
    setCredentialDraft,
    validateCredentialDraftAgainstVault,
    validateSaveCredentialDraftRequest,
} from "../src/background/credential-draft-store";

const DRAFT_STORAGE_KEY = "DRAFT_SAVE";

const sessionStore = new Map<string, unknown>();
const sessionGet = jest.fn(
    async (keys?: string | string[]): Promise<Record<string, unknown>> => {
        const out: Record<string, unknown> = {};
        if (keys == null) {
            for (const [key, value] of sessionStore) out[key] = value;
            return out;
        }
        for (const key of Array.isArray(keys) ? keys : [keys]) {
            if (sessionStore.has(key)) out[key] = sessionStore.get(key);
        }
        return out;
    },
);
const sessionSet = jest.fn(
    async (items: Record<string, unknown>): Promise<void> => {
        for (const [key, value] of Object.entries(items)) {
            sessionStore.set(key, value);
        }
    },
);
const sessionRemove = jest.fn(
    async (keys: string | string[]): Promise<void> => {
        for (const key of Array.isArray(keys) ? keys : [keys]) {
            sessionStore.delete(key);
        }
    },
);

beforeEach(() => {
    sessionStore.clear();
    jest.clearAllMocks();

    globalThis.chrome = {
        storage: {
            session: {
                get: sessionGet,
                set: sessionSet,
                remove: sessionRemove,
            },
        },
    } as unknown as typeof chrome;
});

const validForm = (): CredentialFormSchemaType => ({
    ID: null,
    Type: ItemType.Credentials,
    DirectoryID: "",
    Name: "Example",
    Username: "user",
    Password: "secret",
    TOTP: null,
    Tags: "",
    URL: "",
    URLMatchMode: CredentialURLMatchMode.ExactHost,
    AdditionalURLs: [],
    Notes: "",
    CustomFields: [],
});

const validDraft = (
    overrides: Partial<CredentialDraft> = {},
): CredentialDraft =>
    ({
        vaultDbIndex: 1,
        mode: "create",
        credentialId: null,
        credentialVersion: null,
        form: validForm(),
        stashedAt: 1700000000000,
        ...overrides,
    }) as CredentialDraft;

const makeVault = (
    credentials: Array<{
        ID: string;
        Deleted?: boolean;
        Version?: number;
    }>,
): VaultUtilTypes.Vault =>
    ({
        Credentials: credentials.map((c) => ({
            ID: c.ID,
            Deleted: c.Deleted ?? false,
            Version: c.Version ?? 1,
        })),
    }) as unknown as VaultUtilTypes.Vault;

describe("isCredentialDraft", () => {
    it("accepts a well-formed draft record", () => {
        expect(isCredentialDraft(validDraft())).toBe(true);

        const editDraft = validDraft({
            mode: "edit",
            credentialId: "cred_1",
            credentialVersion: 3,
        });
        expect(isCredentialDraft(editDraft)).toBe(true);
    });

    it("rejects null and undefined", () => {
        expect(isCredentialDraft(null)).toBe(false);
        expect(isCredentialDraft(undefined)).toBe(false);
    });

    it("rejects a wrong mode", () => {
        expect(isCredentialDraft({ ...validDraft(), mode: "hacked" })).toBe(
            false,
        );
    });

    it("rejects non-number vaultDbIndex and stashedAt", () => {
        expect(isCredentialDraft({ ...validDraft(), vaultDbIndex: "1" })).toBe(
            false,
        );
        expect(isCredentialDraft({ ...validDraft(), stashedAt: "now" })).toBe(
            false,
        );
    });

    it("rejects a credentialId that is neither a string nor null", () => {
        expect(isCredentialDraft({ ...validDraft(), credentialId: 42 })).toBe(
            false,
        );
    });

    it("rejects a non-object form and forms missing the spot-checked fields", () => {
        expect(isCredentialDraft({ ...validDraft(), form: "nope" })).toBe(
            false,
        );
        expect(
            isCredentialDraft({
                ...validDraft(),
                form: { ...validForm(), Name: 3 },
            }),
        ).toBe(false);
    });
});

describe("getCredentialDraft / setCredentialDraft / clearCredentialDraft", () => {
    it("returns null when nothing is stored", async () => {
        await expect(getCredentialDraft()).resolves.toBeNull();
    });

    it("round-trips a stored record", async () => {
        const draft = validDraft({
            mode: "edit",
            credentialId: "cred_1",
            credentialVersion: 7,
        });
        await setCredentialDraft(draft);
        await expect(getCredentialDraft()).resolves.toEqual(draft);
    });

    it("removes the key when the stored value is corrupt", async () => {
        sessionStore.set(DRAFT_STORAGE_KEY, { mode: "hacked" });

        await expect(getCredentialDraft()).resolves.toBeNull();
        expect(sessionRemove).toHaveBeenCalledWith(DRAFT_STORAGE_KEY);
        expect(sessionStore.has(DRAFT_STORAGE_KEY)).toBe(false);
    });

    it("set writes the exact record and clear removes it", async () => {
        const draft = validDraft();
        await setCredentialDraft(draft);
        expect(sessionStore.get(DRAFT_STORAGE_KEY)).toEqual(draft);

        await clearCredentialDraft();
        expect(sessionStore.has(DRAFT_STORAGE_KEY)).toBe(false);
        await expect(getCredentialDraft()).resolves.toBeNull();
    });
});

describe("validateCredentialDraftAgainstVault", () => {
    it("restores a create draft for the matching vault", () => {
        expect(
            validateCredentialDraftAgainstVault(validDraft(), makeVault([]), 1),
        ).toBe(true);
    });

    it("restores an edit draft whose credential version matches", () => {
        const draft = validDraft({
            mode: "edit",
            credentialId: "cred_1",
            credentialVersion: 1,
        });
        const vault = makeVault([{ ID: "cred_1", Version: 1 }]);
        expect(validateCredentialDraftAgainstVault(draft, vault, 1)).toBe(true);
    });

    it("drops an edit draft whose credential version changed", () => {
        const draft = validDraft({
            mode: "edit",
            credentialId: "cred_1",
            credentialVersion: 1,
        });
        const vault = makeVault([{ ID: "cred_1", Version: 2 }]);
        expect(validateCredentialDraftAgainstVault(draft, vault, 1)).toBe(
            false,
        );
    });

    it("drops an edit draft whose credential was deleted", () => {
        const draft = validDraft({
            mode: "edit",
            credentialId: "cred_1",
            credentialVersion: 1,
        });
        const vault = makeVault([{ ID: "cred_1", Deleted: true }]);
        expect(validateCredentialDraftAgainstVault(draft, vault, 1)).toBe(
            false,
        );
    });

    it("drops an edit draft whose credential no longer exists", () => {
        const draft = validDraft({
            mode: "edit",
            credentialId: "missing",
            credentialVersion: 1,
        });
        const vault = makeVault([{ ID: "cred_1" }]);
        expect(validateCredentialDraftAgainstVault(draft, vault, 1)).toBe(
            false,
        );
    });

    it("drops a draft that belongs to a different vault", () => {
        const draft = validDraft();
        expect(
            validateCredentialDraftAgainstVault(draft, makeVault([]), 2),
        ).toBe(false);
    });
});

describe("validateSaveCredentialDraftRequest", () => {
    it("accepts a valid create payload and normalizes the form", () => {
        const res = validateSaveCredentialDraftRequest({
            mode: "create",
            form: validForm(),
        });
        expect(res.ok).toBe(true);
        if (res.ok) {
            expect(res.request.mode).toBe("create");
            expect(res.request.credentialId).toBeUndefined();
            expect(res.request.form).toEqual(validForm());
        }
    });

    it("accepts a valid edit payload", () => {
        const res = validateSaveCredentialDraftRequest({
            mode: "edit",
            credentialId: "cred_1",
            form: { ...validForm(), ID: "cred_1" },
        });
        expect(res.ok).toBe(true);
        if (res.ok) {
            expect(res.request.mode).toBe("edit");
            expect(res.request.credentialId).toBe("cred_1");
        }
    });

    it("rejects an edit payload missing its credentialId", () => {
        expect(
            validateSaveCredentialDraftRequest({
                mode: "edit",
                form: validForm(),
            }),
        ).toEqual({ ok: false, error: "DRAFT_CREDENTIAL_ID_REQUIRED" });

        expect(
            validateSaveCredentialDraftRequest({
                mode: "edit",
                credentialId: "",
                form: validForm(),
            }),
        ).toEqual({ ok: false, error: "DRAFT_CREDENTIAL_ID_REQUIRED" });
    });

    it("accepts a password-only form with an empty Name", () => {
        const form = { ...validForm(), Name: "" };
        const res = validateSaveCredentialDraftRequest({
            mode: "create",
            form,
        });
        expect(res.ok).toBe(true);
        if (res.ok) {
            expect(res.request.form).toEqual(form);
        }
    });

    it("accepts an overlong Name (drafts have no max length)", () => {
        const name = "a".repeat(256);
        const res = validateSaveCredentialDraftRequest({
            mode: "create",
            form: { ...validForm(), Name: name },
        });
        expect(res.ok).toBe(true);
        if (res.ok) {
            expect(res.request.form.Name).toBe(name);
        }
    });

    it("accepts a URL that would fail the full schema's URL rule", () => {
        const res = validateSaveCredentialDraftRequest({
            mode: "create",
            form: { ...validForm(), URL: "mailto:foo@bar.com" },
        });
        expect(res.ok).toBe(true);
        if (res.ok) {
            expect(res.request.form.URL).toBe("mailto:foo@bar.com");
        }
    });

    it("still rejects shape violations with INVALID_DRAFT_FORM", () => {
        const shapeViolations: Record<string, unknown> = {
            "non-string Name": { ...validForm(), Name: 42 },
            "non-array AdditionalURLs": { ...validForm(), AdditionalURLs: "x" },
            "CustomFields row missing Name/Type/Value": {
                ...validForm(),
                CustomFields: [{ ID: "1" }],
            },
            "invalid Type enum": { ...validForm(), Type: 999 },
            "invalid URLMatchMode enum": {
                ...validForm(),
                URLMatchMode: "bogus",
            },
        };
        for (const [_what, form] of Object.entries(shapeViolations)) {
            expect(
                validateSaveCredentialDraftRequest({
                    mode: "create",
                    form,
                }),
            ).toEqual({ ok: false, error: "INVALID_DRAFT_FORM" });
        }
    });

    it("rejects a garbage mode and a non-object payload", () => {
        expect(
            validateSaveCredentialDraftRequest({
                mode: "overwrite",
                form: validForm(),
            }),
        ).toEqual({ ok: false, error: "INVALID_DRAFT_MODE" });

        expect(validateSaveCredentialDraftRequest(null)).toEqual({
            ok: false,
            error: "INVALID_DRAFT_PAYLOAD",
        });
    });
});

describe("normalizeDraftForm", () => {
    it("forces ID to null in create mode and to the credentialId in edit mode", () => {
        expect(
            normalizeDraftForm({ ...validForm(), ID: "stale" }, "create", null)
                .ID,
        ).toBeNull();
        expect(
            normalizeDraftForm({ ...validForm(), ID: null }, "edit", "cred_9")
                .ID,
        ).toBe("cred_9");
    });

    it("defaults missing Tags to an empty string", () => {
        const form: CredentialFormSchemaType = {
            ...validForm(),
            Tags: undefined,
        };
        expect(normalizeDraftForm(form, "create", null).Tags).toBe("");
        expect(normalizeDraftForm(validForm(), "create", null).Tags).toBe("");
    });

    it("keeps partially-filled custom fields and drops entirely blank rows", () => {
        const form: CredentialFormSchemaType = {
            ...validForm(),
            CustomFields: [
                {
                    ID: "cf-1",
                    Name: "SS",
                    Type: CustomFieldType.Text,
                    Value: "",
                },
                {
                    ID: "cf-2",
                    Name: "",
                    Type: CustomFieldType.Text,
                    Value: "v",
                },
                {
                    ID: "cf-3",
                    Name: "",
                    Type: CustomFieldType.Text,
                    Value: "",
                },
                {
                    ID: "cf-4",
                    Name: "kept",
                    Type: CustomFieldType.Text,
                    Value: "value",
                },
            ],
        };
        const normalized = normalizeDraftForm(form, "edit", "cred_9");
        expect(normalized.CustomFields).toEqual([
            {
                ID: "cf-1",
                Name: "SS",
                Type: CustomFieldType.Text,
                Value: "",
            },
            {
                ID: "cf-2",
                Name: "",
                Type: CustomFieldType.Text,
                Value: "v",
            },
            {
                ID: "cf-4",
                Name: "kept",
                Type: CustomFieldType.Text,
                Value: "value",
            },
        ]);
    });
});
