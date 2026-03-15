import { useState, useCallback, useEffect, useRef } from "react";
import { useAtomValue, useSetAtom } from "jotai/react";
import { Menu } from "lucide-react";
import { toast } from "sonner";
import { DeviceSidebar } from "./device-sidebar";
import { CredentialsList } from "./credentials-list";
import { CredentialDetail } from "./credential-detail";
import { EditDrawer } from "./edit-drawer";
import { KeyboardShortcutsDialog } from "./keyboard-shortcuts-dialog";
import { VaultSettingsDialog } from "./vault-settings-dialog";
import {
    WarningDialog,
    type WarningDialogShowFn,
} from "@/components/dialog/warning";
import { LogInspectorDialog } from "@/components/dialog/log-inspector";
import { PasswordGeneratorDialog } from "@/components/ui/password-generator";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import {
    clearOnlineServicesAPIKey,
    linkedDevicesAtom,
    unlockedVaultAtom,
    unlockedVaultMetadataAtom,
    unlockedVaultWriteOnlyAtom,
    vaultCredentialsAtom,
} from "@/utils/atoms";
import {
    MISSING_VAULT_SECRET_ERROR,
    clearVaultSecretFromSession,
    saveVaultWithSessionSecret,
} from "@/utils/vault-session";
import {
    LinkedDevice,
    Vault,
    VaultCredential,
    calculateTOTP,
    deleteCredential,
} from "@/app_lib/vault-utils/vault";
import { vaultLogger } from "@/utils/logging";

const DESKTOP_BREAKPOINT = 1024; // lg breakpoint

function useIsDesktop() {
    const [isDesktop, setIsDesktop] = useState(false);

    useEffect(() => {
        const checkDesktop = () =>
            setIsDesktop(window.innerWidth >= DESKTOP_BREAKPOINT);
        checkDesktop();
        window.addEventListener("resize", checkDesktop);
        return () => window.removeEventListener("resize", checkDesktop);
    }, []);

    return isDesktop;
}

export function VaultDashboard() {
    const isDesktop = useIsDesktop();
    const unlockedVault = useAtomValue(unlockedVaultAtom);
    const unlockedVaultMetadata = useAtomValue(unlockedVaultMetadataAtom);
    const vaultCredentials = useAtomValue(vaultCredentialsAtom);
    const linkedDevices = useAtomValue(linkedDevicesAtom);
    const setUnlockedVaultMetadata = useSetAtom(unlockedVaultMetadataAtom);
    const setUnlockedVault = useSetAtom(unlockedVaultWriteOnlyAtom);
    const setVaultCredentials = useSetAtom(vaultCredentialsAtom);
    const setLinkedDevices = useSetAtom(linkedDevicesAtom);
    const unlockedVaultName = unlockedVaultMetadata?.Name?.trim() || "Vault";
    const unlockedVaultDescription = unlockedVaultMetadata?.Description?.trim();

    const credentials = vaultCredentials.filter((c) => !c.Deleted);
    const devices = linkedDevices;

    const [selectedCredential, setSelectedCredential] =
        useState<VaultCredential | null>(null);
    const [editingCredential, setEditingCredential] =
        useState<VaultCredential | null>(null);
    const [isEditDrawerOpen, setIsEditDrawerOpen] = useState(false);
    const [isSidebarOpen, setIsSidebarOpen] = useState(false);
    const [isDetailOpen, setIsDetailOpen] = useState(false);
    const [isPasswordGeneratorOpen, setIsPasswordGeneratorOpen] = useState(false);
    const [isVaultSettingsOpen, setIsVaultSettingsOpen] = useState(false);
    const [isKeyboardShortcutsOpen, setIsKeyboardShortcutsOpen] = useState(false);
    const [searchFocusRequestToken, setSearchFocusRequestToken] = useState(0);
    const [filteredCredentials, setFilteredCredentials] = useState<VaultCredential[]>(
        credentials,
    );
    const showWarningDialogFnRef = useRef<WarningDialogShowFn | null>(null);
    const showLogInspectorDialogRef = useRef<(() => void) | null>(null);
    const pendingKeySequenceRef = useRef<string | null>(null);
    const pendingKeyTimeoutRef = useRef<number | null>(null);

    useEffect(() => {
        if (!selectedCredential) return;

        const fresh = credentials.find((c) => c.ID === selectedCredential.ID);
        if (!fresh) {
            setSelectedCredential(null);
            setIsDetailOpen(false);
            return;
        }

        setSelectedCredential(fresh);
    }, [credentials, selectedCredential]);

    const handleSelectCredential = useCallback((credential: VaultCredential) => {
        setSelectedCredential(Object.assign(new VaultCredential(), credential));
        setIsDetailOpen(true);
    }, []);

    const handleEditCredential = useCallback((credential: VaultCredential) => {
        setEditingCredential(credential);
        setIsEditDrawerOpen(true);
    }, []);

    const handleAddNew = useCallback(() => {
        setEditingCredential(null);
        setIsEditDrawerOpen(true);
    }, []);

    const handleSaveCredential = useCallback(
        async (savedCredential: VaultCredential) => {
            const toastId = toast.loading("Saving vault...");

            const updatedVault = Object.assign(new Vault(), unlockedVault);
            updatedVault.Credentials = [...vaultCredentials];

            const existingIndex = updatedVault.Credentials.findIndex(
                (c) => c.ID === savedCredential.ID,
            );

            if (existingIndex >= 0) {
                updatedVault.Credentials[existingIndex] = savedCredential;
            } else {
                updatedVault.Credentials.push(savedCredential);
            }

            setVaultCredentials(updatedVault.Credentials);

            if (selectedCredential?.ID === savedCredential.ID) {
                setSelectedCredential(savedCredential);
            }
            setEditingCredential(null);

            setUnlockedVault(updatedVault);

            if (!unlockedVaultMetadata) {
                toast.error("Vault metadata is unavailable.");
                return;
            }

            const saveRes = await saveVaultWithSessionSecret(
                unlockedVaultMetadata,
                updatedVault,
            );
            if (saveRes.isErr()) {
                if (saveRes.error === "VAULT_SECRET_NOT_FOUND") {
                    toast.error("Failed to save vault. Vault encryption secret is missing.", {
                        id: toastId,
                    });
                    return;
                }

                toast.error("Failed to save vault. There is a high possibility of data loss!", {
                    id: toastId,
                });
                return;
            }

            toast.success("Vault saved.", {
                id: toastId,
                duration: 3000,
            });
        },
        [selectedCredential, setVaultCredentials, unlockedVault, unlockedVaultMetadata],
    );

    const handleSyncDevice = useCallback((deviceId: string) => {
        setLinkedDevices((prev) =>
            prev.map((device) => {
                if (device.ID !== deviceId) return device;
                const updated = Object.assign(new LinkedDevice(), device);
                updated.updateLastSync();
                return updated;
            }),
        );
    }, [setLinkedDevices]);

    const handleCloseDetail = useCallback(() => {
        setSelectedCredential(null);
        setIsDetailOpen(false);
    }, []);

    const handleCopyUsername = useCallback((credential: VaultCredential) => {
        navigator.clipboard.writeText(credential.Username);
        toast.info("Copied username to clipboard.");
    }, []);

    const handleCopyPassword = useCallback((credential: VaultCredential) => {
        navigator.clipboard.writeText(credential.Password);
        toast.info("Copied password to clipboard.");
    }, []);

    const handleCopyTOTP = useCallback((credential: VaultCredential) => {
        if (!credential.TOTP) return;
        const data = calculateTOTP(credential.TOTP);

        navigator.clipboard.writeText(data.code);
        toast.info(`Copied OTP to clipboard; ${data.timeRemaining} seconds left`, {
            duration: 3000,
            id: "copy-otp",
        });
    }, []);

    const handleOpenCredentialUrl = useCallback((credential: VaultCredential) => {
        if (!credential.URL || !URL.canParse(credential.URL)) {
            toast.error("Credential URL is invalid.");
            return;
        }

        const url = new URL(credential.URL);
        if (url.protocol !== "https:") {
            url.protocol = "https:";
        }

        const urlString = url.toString();
        showWarningDialogFnRef.current?.(
            `You are about to visit "${urlString}"`,
            () => {
                window.open(urlString, "_blank", "noopener,noreferrer");
            },
            () => {
                // No-op
            },
            "Open URL",
        );
    }, []);

    const handleDeleteCredential = useCallback(
        (credential: VaultCredential) => {
            if (!unlockedVaultMetadata) {
                toast.error("Vault metadata is unavailable.");
                return;
            }

            showWarningDialogFnRef.current?.(
                `You are about to remove the "${credential.Name}" credential.`,
                async () => {
                    const toastId = toast.loading("Removing credential...");

                    try {
                        const updatedVault = Object.assign(new Vault(), unlockedVault);
                        const deleted = await deleteCredential(
                            [...updatedVault.Credentials],
                            credential.ID,
                        );

                        if (deleted.isErr()) {
                            toast.error(
                                "Failed to remove credential. Could not find the credential to delete.",
                                { id: toastId },
                            );
                            return;
                        }

                        updatedVault.Credentials = deleted.value;
                        setVaultCredentials(deleted.value);
                        setUnlockedVault(updatedVault);

                        const saveRes = await saveVaultWithSessionSecret(
                            unlockedVaultMetadata,
                            updatedVault,
                        );
                        if (saveRes.isErr()) {
                            if (saveRes.error === "VAULT_SECRET_NOT_FOUND") {
                                toast.error(
                                    "Failed to remove credential. Vault encryption secret is missing.",
                                    { id: toastId },
                                );
                                return;
                            }

                            toast.error(
                                "Failed to remove credential. Failed to save the vault.",
                                { id: toastId },
                            );
                            return;
                        }

                        toast.success("Credential removed.", {
                            id: toastId,
                            duration: 3000,
                        });
                    } catch (error) {
                        console.error("Failed to remove credential", error);
                        toast.error(
                            "Failed to remove credential. Failed to save the vault.",
                            { id: toastId },
                        );
                    }
                },
                () => {
                    // No-op
                },
                "Remove credential",
            );
        },
        [setVaultCredentials, unlockedVault, unlockedVaultMetadata],
    );

    const handleOpenVaultSettings = useCallback(() => {
        setIsVaultSettingsOpen(true);
    }, []);

    const handleOpenPasswordGenerator = useCallback(() => {
        setIsPasswordGeneratorOpen(true);
    }, []);

    const handleLockVault = useCallback(async () => {
        if (!unlockedVaultMetadata) {
            toast.error("Vault metadata is unavailable.");
            return;
        }

        const toastId = toast.loading("Securing vault...");

        const saveRes = await saveVaultWithSessionSecret(
            unlockedVaultMetadata,
            unlockedVault,
        );
        if (saveRes.isErr()) {
            if (saveRes.error === "VAULT_SECRET_NOT_FOUND") {
                toast.error(MISSING_VAULT_SECRET_ERROR, { id: toastId });
                return;
            }

            toast.error("Failed to save vault. There is a high possibility of data loss!", {
                id: toastId,
            });
            return;
        }

        try {
            clearVaultSecretFromSession();

            clearOnlineServicesAPIKey();
            setUnlockedVaultMetadata(null);
            await setUnlockedVault(async () => new Vault());
            vaultLogger.clearAll();

            toast.success("Vault secured.", { id: toastId, duration: 3000 });
        } catch (error) {
            console.error("Failed to lock vault", error);
            toast.error("Failed to lock vault. There is a high possibility of data loss!", {
                id: toastId,
            });
        }
    }, [
        setUnlockedVault,
        setUnlockedVaultMetadata,
        unlockedVault,
        unlockedVaultMetadata,
    ]);

    const lockVaultConfirm = useCallback(() => {
        showWarningDialogFnRef.current?.(
            "Are you sure you want to lock the vault?",
            handleLockVault,
            () => {
                // No-op
            },
            "Lock Vault",
            "This will lock the vault and prevent anyone from accessing it.",
            5,
        );
    }, [handleLockVault]);

    const handleFilteredCredentialsChange = useCallback(
        (nextFilteredCredentials: VaultCredential[]) => {
            setFilteredCredentials((prev) => {
                if (prev.length !== nextFilteredCredentials.length) {
                    return nextFilteredCredentials;
                }

                const hasChanged = prev.some(
                    (credential, index) =>
                        credential.ID !== nextFilteredCredentials[index]?.ID,
                );
                return hasChanged ? nextFilteredCredentials : prev;
            });
        },
        [],
    );

    const clearPendingKeySequence = useCallback(() => {
        pendingKeySequenceRef.current = null;
        if (pendingKeyTimeoutRef.current !== null) {
            window.clearTimeout(pendingKeyTimeoutRef.current);
            pendingKeyTimeoutRef.current = null;
        }
    }, []);

    const selectCredentialAtIndex = useCallback(
        (index: number) => {
            const credential = filteredCredentials[index];
            if (!credential) return;
            handleSelectCredential(credential);
        },
        [filteredCredentials, handleSelectCredential],
    );

    const moveSelection = useCallback(
        (delta: number) => {
            if (filteredCredentials.length === 0) return;

            if (!selectedCredential) {
                const fallbackIndex = delta > 0 ? 0 : filteredCredentials.length - 1;
                selectCredentialAtIndex(fallbackIndex);
                return;
            }

            const currentIndex = filteredCredentials.findIndex(
                (credential) => credential.ID === selectedCredential.ID,
            );
            if (currentIndex < 0) {
                const fallbackIndex = delta > 0 ? 0 : filteredCredentials.length - 1;
                selectCredentialAtIndex(fallbackIndex);
                return;
            }

            const nextIndex = Math.max(
                0,
                Math.min(filteredCredentials.length - 1, currentIndex + delta),
            );
            selectCredentialAtIndex(nextIndex);
        },
        [filteredCredentials, selectCredentialAtIndex, selectedCredential],
    );

    useEffect(() => {
        if (filteredCredentials.length === 0) {
            setSelectedCredential(null);
            setIsDetailOpen(false);
            return;
        }

        if (!selectedCredential) return;
        const selectedStillVisible = filteredCredentials.some(
            (credential) => credential.ID === selectedCredential.ID,
        );
        if (!selectedStillVisible) {
            selectCredentialAtIndex(0);
        }
    }, [filteredCredentials, selectCredentialAtIndex, selectedCredential]);

    useEffect(() => {
        const isTypingElement = (target: EventTarget | null) => {
            if (!(target instanceof HTMLElement)) return false;
            return Boolean(
                target.closest(
                    'input, textarea, select, [contenteditable="true"], [role="textbox"]',
                ),
            );
        };

        const onKeyDown = (event: KeyboardEvent) => {
            if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) {
                return;
            }

            const hasBlockingOverlay =
                isEditDrawerOpen ||
                isSidebarOpen ||
                isVaultSettingsOpen ||
                isPasswordGeneratorOpen;
            if (hasBlockingOverlay) return;

            if (isTypingElement(event.target)) return;

            if (event.key === "?") {
                event.preventDefault();
                setIsKeyboardShortcutsOpen(true);
                clearPendingKeySequence();
                return;
            }

            if (isKeyboardShortcutsOpen) return;

            if (event.key === "/") {
                event.preventDefault();
                setSearchFocusRequestToken((prev) => prev + 1);
                clearPendingKeySequence();
                return;
            }

            if (event.key === "j") {
                event.preventDefault();
                moveSelection(1);
                clearPendingKeySequence();
                return;
            }

            if (event.key === "k") {
                event.preventDefault();
                moveSelection(-1);
                clearPendingKeySequence();
                return;
            }

            if (event.key === "G") {
                event.preventDefault();
                selectCredentialAtIndex(filteredCredentials.length - 1);
                clearPendingKeySequence();
                return;
            }

            if (event.key === "g") {
                event.preventDefault();
                if (pendingKeySequenceRef.current === "g") {
                    selectCredentialAtIndex(0);
                    clearPendingKeySequence();
                    return;
                }

                pendingKeySequenceRef.current = "g";
                if (pendingKeyTimeoutRef.current !== null) {
                    window.clearTimeout(pendingKeyTimeoutRef.current);
                }
                pendingKeyTimeoutRef.current = window.setTimeout(() => {
                    clearPendingKeySequence();
                }, 450);
                return;
            }

            if (event.key === "Enter" || event.key === "o") {
                if (!selectedCredential) return;
                event.preventDefault();
                setIsDetailOpen(true);
                clearPendingKeySequence();
                return;
            }

            clearPendingKeySequence();
        };

        window.addEventListener("keydown", onKeyDown);
        return () => {
            window.removeEventListener("keydown", onKeyDown);
            clearPendingKeySequence();
        };
    }, [
        clearPendingKeySequence,
        filteredCredentials.length,
        isEditDrawerOpen,
        isKeyboardShortcutsOpen,
        isPasswordGeneratorOpen,
        isSidebarOpen,
        isVaultSettingsOpen,
        moveSelection,
        selectCredentialAtIndex,
        selectedCredential,
    ]);

    return (
        <div className="bg-background flex h-screen overflow-hidden">
            {/* Mobile Header */}
            <div className="bg-background border-border fixed left-0 right-0 top-0 z-40 flex items-center justify-between border-b p-2 sm:p-3 lg:hidden">
                <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setIsSidebarOpen(true)}
                    aria-label="Open device menu"
                >
                    <Menu className="h-5 w-5" />
                </Button>
                <span className="text-foreground font-semibold">
                    {unlockedVaultName}
                </span>
                <div className="w-9" /> {/* Spacer for centering */}
            </div>

            {/* Mobile Sidebar Sheet */}
            <Sheet open={isSidebarOpen} onOpenChange={setIsSidebarOpen}>
                <SheetContent side="left" className="w-72 p-0">
                    <DeviceSidebar
                        vaultName={unlockedVaultName}
                        vaultDescription={unlockedVaultDescription}
                        devices={devices}
                        onSyncDevice={handleSyncDevice}
                        onOpenVaultSettings={handleOpenVaultSettings}
                        onOpenPasswordGenerator={handleOpenPasswordGenerator}
                        onLockVault={lockVaultConfirm}
                        isMobile
                        onClose={() => setIsSidebarOpen(false)}
                    />
                </SheetContent>
            </Sheet>

            {/* Desktop Sidebar */}
            <div className="hidden lg:block">
                <DeviceSidebar
                    vaultName={unlockedVaultName}
                    vaultDescription={unlockedVaultDescription}
                    devices={devices}
                    onSyncDevice={handleSyncDevice}
                    onOpenVaultSettings={handleOpenVaultSettings}
                    onOpenPasswordGenerator={handleOpenPasswordGenerator}
                    onLockVault={lockVaultConfirm}
                />
            </div>

            {/* Main Content */}
            <div className="flex min-w-0 flex-1 pt-14 lg:pt-0">
                {/* Credentials List */}
                <CredentialsList
                    credentials={credentials}
                    selectedId={selectedCredential?.ID || null}
                    onSelect={handleSelectCredential}
                    onAddNew={handleAddNew}
                    onCopyUsername={handleCopyUsername}
                    onCopyPassword={handleCopyPassword}
                    onCopyTOTP={handleCopyTOTP}
                    onOpenUrl={handleOpenCredentialUrl}
                    onDeleteCredential={handleDeleteCredential}
                    onFilteredCredentialsChange={handleFilteredCredentialsChange}
                    searchFocusRequestToken={searchFocusRequestToken}
                />

                {/* Desktop Detail Panel */}
                <div className="hidden lg:block">
                    <CredentialDetail
                        credential={selectedCredential}
                        onEdit={handleEditCredential}
                        onClose={handleCloseDetail}
                        onCopyUsername={handleCopyUsername}
                        onCopyPassword={handleCopyPassword}
                        onCopyTOTP={handleCopyTOTP}
                        onOpenUrl={handleOpenCredentialUrl}
                        onDeleteCredential={handleDeleteCredential}
                    />
                </div>

                {/* Mobile Detail Sheet - only renders on mobile */}
                {!isDesktop && (
                    <Sheet
                        open={isDetailOpen && !!selectedCredential}
                        onOpenChange={(open) => {
                            if (!open) handleCloseDetail();
                        }}
                    >
                        <SheetContent
                            side="right"
                            className="w-full p-0 sm:w-96"
                        >
                            <CredentialDetail
                                credential={selectedCredential}
                                onEdit={handleEditCredential}
                                onClose={handleCloseDetail}
                                isMobile
                                onCopyUsername={handleCopyUsername}
                                onCopyPassword={handleCopyPassword}
                                onCopyTOTP={handleCopyTOTP}
                                onOpenUrl={handleOpenCredentialUrl}
                                onDeleteCredential={handleDeleteCredential}
                            />
                        </SheetContent>
                    </Sheet>
                )}
            </div>

            {/* Edit Drawer */}
            <EditDrawer
                credential={editingCredential}
                isOpen={isEditDrawerOpen}
                onClose={() => setIsEditDrawerOpen(false)}
                onSave={handleSaveCredential}
            />
            <div className="fixed bottom-4 left-4 right-4 z-50 lg:left-3 lg:right-auto">
            </div>
            <PasswordGeneratorDialog
                open={isPasswordGeneratorOpen}
                onOpenChange={setIsPasswordGeneratorOpen}
            />
            <VaultSettingsDialog
                open={isVaultSettingsOpen}
                onOpenChange={setIsVaultSettingsOpen}
                onOpenLogInspector={() => showLogInspectorDialogRef.current?.()}
            />
            <LogInspectorDialog showDialogFnRef={showLogInspectorDialogRef} />
            <WarningDialog showFnRef={showWarningDialogFnRef} />
            <KeyboardShortcutsDialog
                open={isKeyboardShortcutsOpen}
                onOpenChange={setIsKeyboardShortcutsOpen}
            />
        </div>
    );
}
