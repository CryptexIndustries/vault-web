import { useCallback, useEffect, useMemo, useState } from "react";
import { TRPCClientError } from "@trpc/client";
import type * as VaultUtilTypes from "@cryptex-industries/vault-core/proto";
import {
    ShareSetupError,
    type ShareLinkStore,
} from "@cryptex-industries/vault-core/vault-utils/share-service";
import type { ShareBackend } from "@/components/share/share-backend";
import { env } from "./env";
import { trpc } from "./trpc-ext";
import { MessageType } from "./types/sw-messaging";
import { sendEncryptedEnvelopeToSW } from "./utils/sw-envelope-client";

type ShareState = {
    shareLinks: VaultUtilTypes.ShareLink[];
    settings: VaultUtilTypes.ShareSettings | null;
    hasOnlineServicesSession: boolean;
    vaultDbIndex: number | null;
};

const SHARE_UPDATE_BATCH_SIZE = 500;

async function readShareState(): Promise<ShareState> {
    const result = await sendEncryptedEnvelopeToSW<
        ({ ok: true } & ShareState) | { ok: false; error: string }
    >(MessageType.GetShareLinks, null);
    if (!result.ok || !result.payload.ok) {
        throw new Error("Couldn't read shared links from the vault.");
    }
    return result.payload;
}

async function writeToSW(
    type: MessageType.UpdateShareLinks | MessageType.SaveShareSettings,
    payload: object,
): Promise<void> {
    const result = await sendEncryptedEnvelopeToSW<
        { ok: true } | { ok: false; error: string }
    >(type, payload);
    if (!result.ok || !result.payload.ok) {
        throw new Error("Couldn't save to the vault.");
    }
}

async function requestShareTicket(): Promise<string> {
    try {
        return (await trpc.v1.share.ticket.mutate()).ticket;
    } catch (error) {
        if (error instanceof TRPCClientError) {
            const code = (error.data as { code?: string } | undefined)?.code;
            if (code === "FORBIDDEN") {
                throw new ShareSetupError("subscription_required");
            }
            if (code === "UNAUTHORIZED") {
                throw new ShareSetupError("sign_in_required");
            }
        }
        throw error;
    }
}

/**
 * Share UI wiring for the extension popup. The vault lives in the service
 * worker, so records are read and merged through encrypted SW messages.
 */
export function useExtensionShareBackend(): {
    backend: ShareBackend;
    shareLinks: VaultUtilTypes.ShareLink[];
    reload: () => Promise<void>;
} {
    const [shareLinks, setShareLinks] = useState<VaultUtilTypes.ShareLink[]>(
        [],
    );
    const [hasSession, setHasSession] = useState(false);
    const [passwordSharing, setPasswordSharing] = useState<
        boolean | undefined
    >();

    const reload = useCallback(async () => {
        const state = await readShareState();
        setShareLinks(state.shareLinks);
        setHasSession(
            env.NEXT_PUBLIC_CLOUD_ENABLED && state.hasOnlineServicesSession,
        );
    }, []);

    useEffect(() => {
        void reload().catch(() => undefined);
    }, [reload]);

    useEffect(() => {
        if (!hasSession) {
            setPasswordSharing(undefined);
            return;
        }
        let cancelled = false;
        trpc.v1.user.configuration
            .query()
            .then((config) => {
                if (!cancelled) setPasswordSharing(config.passwordSharing);
            })
            .catch(() => undefined);
        return () => {
            cancelled = true;
        };
    }, [hasSession]);

    const store = useMemo<ShareLinkStore>(
        () => ({
            getShareLinks: async () => (await readShareState()).shareLinks,
            updateShareLinks: async (update) => {
                const current = (await readShareState()).shareLinks;
                const next = await update(current);
                const before = new Map(
                    current.map((record) => [record.ID, record]),
                );
                // Only send what changed; the SW merges by version.
                const changed = next.filter(
                    (record) => before.get(record.ID) !== record,
                );
                // The SW accepts at most 1000 records per message.
                for (
                    let start = 0;
                    start < changed.length;
                    start += SHARE_UPDATE_BATCH_SIZE
                ) {
                    await writeToSW(MessageType.UpdateShareLinks, {
                        shareLinks: changed.slice(
                            start,
                            start + SHARE_UPDATE_BATCH_SIZE,
                        ),
                    });
                }
                await reload();
            },
            getShareSettings: async () =>
                (await readShareState()).settings ?? undefined,
            vaultKey: async () =>
                (await readShareState()).vaultDbIndex ?? undefined,
        }),
        [reload],
    );

    const backend = useMemo<ShareBackend>(
        () => ({
            deps: {
                store,
                defaultOrigin: env.NEXT_PUBLIC_APP_URL,
                getTicket: hasSession ? requestShareTicket : undefined,
            },
            hasOnlineServicesSharing: hasSession ? passwordSharing : undefined,
            allowCustomServer: true,
            reload,
            saveSettings: (settings) =>
                writeToSW(MessageType.SaveShareSettings, { settings }),
        }),
        [hasSession, passwordSharing, reload, store],
    );

    return { backend, shareLinks, reload };
}
