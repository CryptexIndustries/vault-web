import { memo } from "react";
import { Virtuoso } from "react-virtuoso";
import {
    Copy,
    Edit,
    Fingerprint,
    Key,
    Loader2,
    MoreHorizontal,
    Trash2,
} from "lucide-react";
import * as VaultUtilTypes from "@cryptex-industries/vault-core/proto";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { LiteCredential } from "../types/sw-messaging";
import { CredentialListIcon } from "./credential-list-icon";

/** Must keep a stable identity, or every row re-renders with the parent. */
export type CredentialListActions = {
    select: (id: string) => void;
    edit: (id: string) => void;
    remove: (id: string, name: string) => void;
    copySSHPublicKey: (id: string) => void;
    copyUsername: (username: string) => void;
};

type CredentialRowProps = {
    credential: LiteCredential;
    isSelected: boolean;
    isDeleting: boolean;
    actions: CredentialListActions;
};

const CredentialRow = memo(function CredentialRow({
    credential,
    isSelected,
    isDeleting,
    actions,
}: CredentialRowProps) {
    return (
        <div className="px-2 pb-2">
            <div
                role="button"
                tabIndex={0}
                className={`group cursor-pointer rounded-lg border bg-card transition-all duration-150 ${
                    isSelected
                        ? "border-primary bg-primary/5"
                        : "border-border hover:border-primary/50"
                }`}
                onClick={() => actions.select(credential.id)}
                onKeyDown={(e: React.KeyboardEvent) => {
                    if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        actions.select(credential.id);
                    }
                }}
            >
                <div className="flex items-center justify-between gap-2 p-3">
                    <div className="flex min-w-0 flex-1 items-center gap-3">
                        <CredentialListIcon
                            type={credential.type}
                            hasPasskey={Boolean(credential.passkey)}
                        />
                        <div className="min-w-0 flex-1">
                            <div className="mb-1 flex min-w-0 items-center gap-1.5">
                                <span className="block min-w-0 truncate text-sm font-medium leading-tight text-foreground">
                                    {credential.name}
                                </span>
                                {credential.hasTOTP ? (
                                    <Badge
                                        variant="outline"
                                        className="h-5 shrink-0 border-primary/20 bg-primary/10 px-1.5 py-0 text-[10px] text-primary"
                                    >
                                        <Key className="mr-1 h-3 w-3" />
                                        2FA
                                    </Badge>
                                ) : null}
                                {credential.passkey ? (
                                    <Badge
                                        variant="outline"
                                        className="h-5 shrink-0 border-primary/20 bg-primary/10 px-1.5 py-0 text-[10px] text-primary"
                                    >
                                        <Fingerprint className="mr-1 h-3 w-3" />
                                        Passkey
                                    </Badge>
                                ) : null}
                            </div>
                            {credential.type ===
                            VaultUtilTypes.ItemType.SSHKey ? (
                                <div className="flex min-w-0 items-center gap-2 text-xs leading-tight text-muted-foreground">
                                    <span className="shrink-0">
                                        {credential.sshKey?.label || "SSH key"}
                                    </span>
                                    {credential.sshKey?.comment ? (
                                        <span className="min-w-0 truncate text-muted-foreground/70">
                                            {credential.sshKey.comment}
                                        </span>
                                    ) : null}
                                </div>
                            ) : (
                                <div className="truncate text-xs leading-tight text-muted-foreground">
                                    {credential.type ===
                                    VaultUtilTypes.ItemType.Passkey
                                        ? credential.passkey?.UserDisplayName ||
                                          credential.passkey?.UserName ||
                                          "Passkey"
                                        : credential.username}
                                </div>
                            )}
                        </div>
                    </div>
                    <DropdownMenu>
                        <DropdownMenuTrigger
                            asChild
                            onClick={(e: React.MouseEvent) =>
                                e.stopPropagation()
                            }
                        >
                            <Button
                                variant="ghost"
                                size="icon"
                                className="h-9 w-9 shrink-0"
                                aria-label={`Actions for ${credential.name}`}
                            >
                                <MoreHorizontal className="h-4 w-4" />
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-40">
                            <DropdownMenuItem
                                onClick={(e: React.MouseEvent) => {
                                    e.stopPropagation();
                                    actions.edit(credential.id);
                                }}
                            >
                                <Edit className="mr-2 h-4 w-4" />
                                Edit
                            </DropdownMenuItem>
                            <DropdownMenuItem
                                onClick={(e: React.MouseEvent) => {
                                    e.stopPropagation();
                                    actions.remove(
                                        credential.id,
                                        credential.name,
                                    );
                                }}
                                className="text-destructive"
                                disabled={isDeleting}
                            >
                                {isDeleting ? (
                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                ) : (
                                    <Trash2 className="mr-2 h-4 w-4" />
                                )}
                                {isDeleting ? "Deleting..." : "Delete"}
                            </DropdownMenuItem>
                            {credential.type ===
                            VaultUtilTypes.ItemType.SSHKey ? (
                                <DropdownMenuItem
                                    onClick={(e: React.MouseEvent) => {
                                        e.stopPropagation();
                                        actions.copySSHPublicKey(credential.id);
                                    }}
                                >
                                    <Copy className="mr-2 h-4 w-4" />
                                    Copy public key
                                </DropdownMenuItem>
                            ) : (
                                <DropdownMenuItem
                                    onClick={(e: React.MouseEvent) => {
                                        e.stopPropagation();
                                        actions.copyUsername(
                                            credential.username,
                                        );
                                    }}
                                >
                                    <Copy className="mr-2 h-4 w-4" />
                                    Copy username
                                </DropdownMenuItem>
                            )}
                        </DropdownMenuContent>
                    </DropdownMenu>
                </div>
            </div>
        </div>
    );
});

const ListTopSpacer = () => <div className="h-2" />;
const LIST_COMPONENTS = { Header: ListTopSpacer };

/**
 * Renders only the rows near the viewport of `scrollParent`, which also
 * scrolls the "For this site" section above the list.
 */
export const PopupCredentialList = memo(function PopupCredentialList({
    credentials,
    selectedId,
    isDeleting,
    actions,
    scrollParent,
}: {
    credentials: LiteCredential[];
    selectedId: string | undefined;
    isDeleting: boolean;
    actions: CredentialListActions;
    scrollParent: HTMLElement;
}) {
    return (
        <Virtuoso
            customScrollParent={scrollParent}
            data={credentials}
            computeItemKey={(_index, credential) => credential.id}
            increaseViewportBy={400}
            components={LIST_COMPONENTS}
            itemContent={(_index, credential) => (
                <CredentialRow
                    credential={credential}
                    isSelected={credential.id === selectedId}
                    isDeleting={isDeleting}
                    actions={actions}
                />
            )}
        />
    );
});
