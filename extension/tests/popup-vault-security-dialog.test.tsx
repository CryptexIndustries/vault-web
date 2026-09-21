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

import { AdditionalKeyProtectionKind } from "@cryptex-industries/vault-core/proto";
import { MessageType } from "../src/types/sw-messaging";

const sendToSwMock = jest.fn();
const toastErrorMock = jest.fn();

jest.mock("../src/utils/sw-envelope-client", () => ({
    sendEncryptedEnvelopeToSW: sendToSwMock,
}));

jest.mock("sonner", () => ({
    toast: {
        error: toastErrorMock,
        success: jest.fn(),
        info: jest.fn(),
    },
}));

import { PopupVaultSecurityDialog } from "../src/components/popup-vault-security-dialog";

(
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function input(id: string, value: string): void {
    const element = document.getElementById(id) as HTMLInputElement | null;
    if (!element) throw new Error(`Input not found: ${id}`);
    act(() => {
        Object.getOwnPropertyDescriptor(
            HTMLInputElement.prototype,
            "value",
        )?.set?.call(element, value);
        element.dispatchEvent(new Event("input", { bubbles: true }));
    });
}

async function click(element: HTMLElement): Promise<void> {
    await act(async () => {
        element.click();
        await Promise.resolve();
    });
}

function button(text: string): HTMLButtonElement {
    const found = [...document.body.querySelectorAll("button")].find(
        (candidate) => candidate.textContent?.includes(text),
    );
    if (!(found instanceof HTMLButtonElement)) {
        throw new Error(`Button not found: ${text}`);
    }
    return found;
}

describe("PopupVaultSecurityDialog", () => {
    let host: HTMLDivElement;
    let root: Root;
    const onOpenChange = jest.fn();
    const onSessionInvalidated = jest.fn();

    beforeEach(async () => {
        jest.clearAllMocks();
        sendToSwMock.mockImplementation(async (type: MessageType) => {
            if (type === MessageType.GetVaultSecurity) {
                return {
                    ok: true,
                    payload: {
                        ok: true,
                        additionalKeyProtectionKind:
                            AdditionalKeyProtectionKind.NONE,
                        kdf: { memLimit: 256, opsLimit: 3 },
                        webAuthnUnsupported: false,
                    },
                };
            }
            if (type === MessageType.RotateVaultRecoveryCode) {
                return {
                    ok: true,
                    payload: {
                        ok: true,
                        dataKeyRotated: true,
                        recoveryCode: "extension-recovery-code",
                        additionalKeyProtectionKind:
                            AdditionalKeyProtectionKind.NONE,
                        sessionContinued: true,
                        backupError: "BACKUP_QUEUE_FAILED",
                    },
                };
            }
            return { ok: false, error: "UNEXPECTED_MESSAGE" };
        });
        host = document.createElement("div");
        document.body.append(host);
        root = createRoot(host);
        await act(async () => {
            root.render(
                <PopupVaultSecurityDialog
                    open
                    onOpenChange={onOpenChange}
                    onSessionInvalidated={onSessionInvalidated}
                />,
            );
            await Promise.resolve();
            await Promise.resolve();
        });
    });

    afterEach(() => {
        act(() => root.unmount());
        host.remove();
    });

    it("loads state through the encrypted SW channel with opt-ins off", () => {
        expect(sendToSwMock).toHaveBeenCalledWith(
            MessageType.GetVaultSecurity,
            null,
        );
        for (const id of [
            "extension-protection-rotate-dek",
            "extension-protection-delete-managed-history",
            "extension-recovery-rotate-dek",
            "extension-recovery-delete-managed-history",
        ]) {
            expect(
                document.getElementById(id)?.getAttribute("data-state"),
            ).toBe("unchecked");
        }
        expect(document.body.textContent).not.toContain("WebAuthn support");
    });

    it("sends secrets only inside the encrypted request and requires reveal acknowledgement", async () => {
        input("extension-current-password", "current-password");
        await click(document.getElementById("extension-recovery-rotate-dek")!);
        await click(
            document.getElementById(
                "extension-recovery-delete-managed-history",
            )!,
        );
        await click(button("Generate new recovery code"));

        expect(sendToSwMock).toHaveBeenCalledWith(
            MessageType.RotateVaultRecoveryCode,
            {
                currentMasterPassword: "current-password",
                rotateDataKey: true,
                deleteOlderManagedBackups: true,
            },
        );
        expect(
            (
                document.getElementById(
                    "extension-current-password",
                ) as HTMLInputElement
            ).value,
        ).toBe("");
        expect(document.body.textContent).toContain("extension-recovery-code");
        expect(button("Close").disabled).toBe(true);

        await click(
            document.getElementById("extension-security-secrets-saved")!,
        );
        await click(button("Close"));
        expect(onOpenChange).toHaveBeenCalledWith(false);
        expect(onSessionInvalidated).not.toHaveBeenCalled();
        expect(toastErrorMock).toHaveBeenCalledWith(
            "The local security change succeeded, but its managed backup could not be queued.",
        );
    });

    it("clears current authorization but keeps proposed settings after failure", async () => {
        input("extension-current-password", "wrong-password");
        input("extension-new-password", "proposed-password");
        input("extension-confirm-password", "proposed-password");
        await click(
            document.getElementById("extension-protection-rotate-dek")!,
        );
        await click(button("Save protection settings"));

        expect(
            (
                document.getElementById(
                    "extension-current-password",
                ) as HTMLInputElement
            ).value,
        ).toBe("");
        expect(
            (
                document.getElementById(
                    "extension-new-password",
                ) as HTMLInputElement
            ).value,
        ).toBe("proposed-password");
        expect(
            document
                .getElementById("extension-protection-rotate-dek")
                ?.getAttribute("data-state"),
        ).toBe("checked");
        expect(toastErrorMock).toHaveBeenCalledWith(
            "Failed to update vault security settings.",
        );
    });

    it("preserves one-time secrets and requires re-unlock when session continuation fails", async () => {
        sendToSwMock.mockResolvedValueOnce({
            ok: true,
            payload: {
                ok: true,
                dataKeyRotated: true,
                recoveryCode: "durably-saved-recovery-code",
                additionalKeyProtectionKind: AdditionalKeyProtectionKind.NONE,
                deviceKeyProtectionCached: true,
                sessionContinued: false,
                backupError: "BACKUP_VAULT_UNAVAILABLE",
            },
        });
        input("extension-current-password", "current-password");
        await click(document.getElementById("extension-recovery-rotate-dek")!);
        await click(button("Generate new recovery code"));

        expect(document.body.textContent).toContain(
            "durably-saved-recovery-code",
        );
        expect(document.body.textContent).toContain(
            "this unlocked session ended",
        );
        expect(button("Generate new recovery code").disabled).toBe(true);

        await click(
            document.getElementById("extension-security-secrets-saved")!,
        );
        await click(button("Close"));
        expect(onSessionInvalidated).toHaveBeenCalledTimes(1);
    });

    it("disables extension changes for an existing WebAuthn PRF vault", async () => {
        sendToSwMock.mockResolvedValueOnce({
            ok: true,
            payload: {
                ok: true,
                additionalKeyProtectionKind:
                    AdditionalKeyProtectionKind.WEBAUTHN_PRF,
                kdf: { memLimit: 256, opsLimit: 3 },
                webAuthnUnsupported: true,
            },
        });

        act(() => {
            root.render(
                <PopupVaultSecurityDialog
                    open={false}
                    onOpenChange={onOpenChange}
                    onSessionInvalidated={onSessionInvalidated}
                />,
            );
        });
        await act(async () => {
            root.render(
                <PopupVaultSecurityDialog
                    open
                    onOpenChange={onOpenChange}
                    onSessionInvalidated={onSessionInvalidated}
                />,
            );
            await Promise.resolve();
            await Promise.resolve();
        });

        expect(document.body.textContent).toContain("uses WebAuthn PRF");
        expect(button("Save protection settings").disabled).toBe(true);
        expect(button("Generate new recovery code").disabled).toBe(true);
    });
});
