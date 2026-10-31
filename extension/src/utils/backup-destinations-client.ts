import { useCallback, useEffect, useState } from "react";
import type * as VaultUtilTypes from "@cryptex-industries/vault-core/proto";
import type { BackupDestinationStatus } from "@cryptex-industries/vault-core/vault-utils/backup-destination-scheduler";
import type { BackupDestinationsController } from "@/components/vault-dashboard/backup-destination-dialog";

import { env } from "../env";
import { MessageType } from "../types/sw-messaging";
import { sendEncryptedEnvelopeToSW } from "./sw-envelope-client";

type View = {
    destinations: VaultUtilTypes.BackupDestination[];
    statuses: Record<string, BackupDestinationStatus>;
};

type Response<T = object> = ({ ok: true } & T) | { ok: false; error: string };

async function send<T = object>(
    type: MessageType,
    payload: object | null,
): Promise<T> {
    const result = await sendEncryptedEnvelopeToSW<Response<T>>(type, payload);
    if (!result.ok) throw new Error(result.error);
    if (!result.payload.ok) throw new Error(result.payload.error);
    return result.payload;
}

const POLL_MS = 2_000;

/** Destinations and upload status from the service worker, polled while open. */
export function useExtensionBackupDestinationsController(
    open: boolean,
): BackupDestinationsController {
    const [view, setView] = useState<View>({ destinations: [], statuses: {} });

    const refresh = useCallback(async () => {
        try {
            const next = await send<View>(
                MessageType.GetBackupDestinations,
                null,
            );
            setView({
                destinations: next.destinations,
                statuses: next.statuses,
            });
        } catch {
            // Locked or the worker restarted; the next poll tries again.
        }
    }, []);

    useEffect(() => {
        if (!open) return;
        void refresh();
        const timer = setInterval(() => void refresh(), POLL_MS);
        return () => clearInterval(timer);
    }, [open, refresh]);

    return {
        ...view,
        save: async (change) => {
            await send(MessageType.SaveBackupDestinations, { change });
            await refresh();
        },
        backupNow: async (destinationID) => {
            try {
                await send(MessageType.BackupDestinationNow, {
                    id: destinationID,
                });
            } finally {
                await refresh();
            }
        },
        describeError: (error) =>
            error instanceof Error ? error.message : null,
        docsUrl: new URL(
            "/docs/backup-destinations",
            env.NEXT_PUBLIC_APP_URL || "https://www.cryptex-vault.com",
        ).href,
    };
}
