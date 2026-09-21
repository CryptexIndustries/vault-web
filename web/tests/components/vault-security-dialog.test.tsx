/** @jest-environment jsdom */
import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    jest,
} from "@jest/globals";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Provider } from "jotai/react";
import { err, ok, type Result } from "neverthrow";

import { AdditionalKeyProtectionKind } from "@cryptex-industries/vault-core/proto";
import type { VaultMetadata } from "../../src/app_lib/vault-utils/storage";

type SecurityResult = {
    dataKeyRotated: boolean;
    deviceKeyProtectionCached: boolean;
    recoveryCode: string;
    additionalKeyProtectionKind: AdditionalKeyProtectionKind;
};

const reconfigureMock =
    jest.fn<() => Promise<Result<SecurityResult, string>>>();
const rotateRecoveryMock =
    jest.fn<() => Promise<Result<SecurityResult, string>>>();
const toastErrorMock = jest.fn();

jest.mock("../../src/utils/vault-security-mutations", () => ({
    reconfigureUnlockedVaultSecurity: reconfigureMock,
    rotateUnlockedVaultRecoveryCode: rotateRecoveryMock,
}));

jest.mock("sonner", () => ({
    toast: {
        error: toastErrorMock,
        success: jest.fn(),
    },
}));

import { VaultSecurityDialog } from "../../src/components/vault-dashboard/vault-security-dialog";
import { unlockedVaultMetadataAtom, vaultStore } from "../../src/utils/atoms";

(
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function click(element: HTMLElement): Promise<void> {
    return act(async () => {
        element.click();
        await Promise.resolve();
    });
}

function input(id: string, value: string): void {
    const element = document.getElementById(id) as HTMLInputElement | null;
    if (!element) throw new Error(`Input not found: ${id}`);
    act(() => {
        const descriptor = Object.getOwnPropertyDescriptor(
            HTMLInputElement.prototype,
            "value",
        );
        descriptor?.set?.call(element, value);
        element.dispatchEvent(new Event("input", { bubbles: true }));
    });
}

function button(text: string): HTMLButtonElement {
    const result = [...document.body.querySelectorAll("button")].find(
        (candidate) => candidate.textContent?.includes(text),
    );
    if (!(result instanceof HTMLButtonElement)) {
        throw new Error(`Button not found: ${text}`);
    }
    return result;
}

describe("VaultSecurityDialog", () => {
    let host: HTMLDivElement;
    let root: Root;
    const onOpenChange = jest.fn();

    beforeEach(() => {
        jest.clearAllMocks();
        reconfigureMock.mockResolvedValue(
            ok({
                dataKeyRotated: false,
                deviceKeyProtectionCached: true,
                recoveryCode: "",
                additionalKeyProtectionKind: AdditionalKeyProtectionKind.NONE,
            }),
        );
        rotateRecoveryMock.mockResolvedValue(
            ok({
                dataKeyRotated: true,
                deviceKeyProtectionCached: true,
                recoveryCode: "new-recovery-code",
                additionalKeyProtectionKind: AdditionalKeyProtectionKind.NONE,
            }),
        );
        vaultStore.set(unlockedVaultMetadataAtom, {
            Blob: {
                Envelope: {
                    PrimaryProtectionKind: AdditionalKeyProtectionKind.NONE,
                },
                KDFConfigArgon2ID: { memLimit: 256, opsLimit: 3 },
            },
        } as unknown as VaultMetadata);
        host = document.createElement("div");
        document.body.append(host);
        root = createRoot(host);
        act(() => {
            root.render(
                <Provider store={vaultStore}>
                    <VaultSecurityDialog open onOpenChange={onOpenChange} />
                </Provider>,
            );
        });
    });

    afterEach(() => {
        act(() => root.unmount());
        host.remove();
    });

    it("defaults both DEK rotations and history deletion options to off", () => {
        for (const id of [
            "protection-rotate-data-key",
            "protection-delete-old-backups",
            "recovery-rotate-data-key",
            "recovery-delete-old-backups",
        ]) {
            expect(
                document.getElementById(id)?.getAttribute("data-state"),
            ).toBe("unchecked");
        }
    });

    it("passes explicit recovery options and blocks closing until the new code is acknowledged", async () => {
        input("current-master-password", "current-password");
        await click(document.getElementById("recovery-rotate-data-key")!);
        await click(document.getElementById("recovery-delete-old-backups")!);
        await click(button("Generate new recovery code"));

        expect(rotateRecoveryMock).toHaveBeenCalledWith({
            currentMasterPassword: "current-password",
            currentProtectionPhrase: undefined,
            rotateDataKey: true,
            deleteOlderManagedBackups: true,
        });
        expect(
            (
                document.getElementById(
                    "current-master-password",
                ) as HTMLInputElement
            ).value,
        ).toBe("");
        expect(document.body.textContent).toContain("new-recovery-code");
        expect(button("Close").disabled).toBe(true);

        await click(document.getElementById("vault-security-secrets-saved")!);
        expect(button("Close").disabled).toBe(false);
        await click(button("Close"));
        expect(onOpenChange).toHaveBeenCalledWith(false);
    });

    it("keeps one-time secrets visible when committed metadata is published", async () => {
        reconfigureMock.mockImplementation(async () => {
            vaultStore.set(unlockedVaultMetadataAtom, {
                Blob: {
                    Envelope: {
                        PrimaryProtectionKind: AdditionalKeyProtectionKind.NONE,
                    },
                    KDFConfigArgon2ID: { memLimit: 256, opsLimit: 3 },
                },
            } as unknown as VaultMetadata);
            return ok({
                dataKeyRotated: true,
                deviceKeyProtectionCached: true,
                recoveryCode: "rotated-recovery-code",
                additionalKeyProtectionKind: AdditionalKeyProtectionKind.NONE,
            });
        });

        input("current-master-password", "current-password");
        await click(document.getElementById("protection-rotate-data-key")!);
        await click(button("Save protection settings"));

        expect(document.body.textContent).toContain("New recovery code");
        expect(document.body.textContent).toContain("rotated-recovery-code");
        expect(button("Close").disabled).toBe(true);
    });

    it("clears authorization but keeps proposed options after a failed update", async () => {
        reconfigureMock.mockResolvedValue(err("DEK_UNWRAP_FAILED"));
        input("current-master-password", "wrong-password");
        await click(document.getElementById("protection-rotate-data-key")!);
        await click(button("Save protection settings"));

        expect(
            (
                document.getElementById(
                    "current-master-password",
                ) as HTMLInputElement
            ).value,
        ).toBe("");
        expect(
            document
                .getElementById("protection-rotate-data-key")
                ?.getAttribute("data-state"),
        ).toBe("checked");
        expect(toastErrorMock).toHaveBeenCalledWith(
            "Current master password or protection phrase is incorrect.",
        );
    });
});
