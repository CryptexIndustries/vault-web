"use client";

import dynamic from "next/dynamic";
import { Loader2 } from "lucide-react";

import { buildDeviceRelationshipMap } from "./device-topology";

const DevicesConstellation = dynamic(
    () =>
        import("../device-tab").then((m) => ({
            default: m.DevicesConstellation,
        })),
    {
        ssr: false,
        loading: () => (
            <div className="grid h-[26rem] place-items-center rounded-xl border bg-card text-sm text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin" />
            </div>
        ),
    },
);

type AccountDevicesProps = {
    hasDevices: boolean;
    deviceRelationshipMap: ReturnType<typeof buildDeviceRelationshipMap>;
    isRoot: boolean;
    canPromote: boolean;
    removing: boolean;
    promoting: boolean;
    onRemove: (id: string) => void;
    onToggleRoot: (id: string, root: boolean) => void;
};

export function AccountDevices({
    hasDevices,
    deviceRelationshipMap,
    isRoot,
    canPromote,
    removing,
    promoting,
    onRemove,
    onToggleRoot,
}: AccountDevicesProps) {
    if (!isRoot) {
        return (
            <p className="text-sm text-muted-foreground">
                Only the root device can manage linked devices.
            </p>
        );
    }

    if (!hasDevices) {
        return (
            <p className="text-sm text-muted-foreground">No devices loaded.</p>
        );
    }

    return (
        <DevicesConstellation
            map={deviceRelationshipMap}
            canPromote={canPromote}
            removing={removing}
            promoting={promoting}
            onRemove={onRemove}
            onToggleRoot={onToggleRoot}
        />
    );
}
