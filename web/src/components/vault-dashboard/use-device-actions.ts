"use client";
import { useRef, useState } from "react";
import { toast } from "sonner";
import {
    LinkedDevices,
    Vault,
    type LinkedDevice,
} from "@cryptex-industries/vault-core/vault-utils/vault";
import { persistVaultMutation } from "@/utils/vault-mutations";
import { trpcReact } from "@/utils/trpc";
import { isCloudServicesEnabled } from "@/utils/online-services-api-url";
import { vaultGet } from "@/utils/atoms";

export async function removeLocalDeviceRecords(ids: string[]) {
    const result = await persistVaultMutation(
        "vault.configuration",
        (current) => {
            const next = Object.assign(new Vault(), current);
            next.LinkedDevices = LinkedDevices.fromGeneric(
                current.LinkedDevices,
            );
            next.LinkedDevices.Devices = next.LinkedDevices.Devices.filter(
                (d) => !ids.includes(d.ID),
            );
            return { vault: next, result: undefined };
        },
    );
    if (result.isErr())
        throw new Error(
            "Could not save the local link changes. The Linked Devices list was kept; retry removing the saved link.",
        );
}

export function useDeviceActions() {
    const utils = trpcReact.useUtils();
    const breakLink = trpcReact.v1.device.breakLink.useMutation();
    const [pendingId, setPendingId] = useState<string | null>(null);
    const inFlight = useRef(false);
    const unlink = async (device: LinkedDevice, localOnly = false) => {
        if (inFlight.current) return;
        inFlight.current = true;
        setPendingId(device.ID);
        try {
            const current = vaultGet().LinkedDevices.Devices.find(
                (d) => d.ID === device.ID,
            );
            if (!current) return;
            if (!localOnly && LinkedDevices.isUsingOnlineServices(current)) {
                if (!isCloudServicesEnabled())
                    throw new Error(
                        "Online Services is unavailable. Device details offer an option to remove the saved link from this vault.",
                    );
                await breakLink.mutateAsync({ syncId: current.SyncID });
            }
            await removeLocalDeviceRecords([current.ID]);
            toast.success(
                localOnly
                    ? "Saved link removed from this vault."
                    : "Device unlinked from this vault.",
            );
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : "Could not unlink this device.",
            );
            throw error;
        } finally {
            inFlight.current = false;
            setPendingId(null);
            void utils.v1.device.invalidate();
            void utils.v1.payment.subscription.invalidate();
        }
    };
    return { unlink, pendingId };
}
