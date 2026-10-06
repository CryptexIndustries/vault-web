"use client";
import dynamic from "next/dynamic";
import { Loader2 } from "lucide-react";
import type { DevicesPanelProps } from "../device-tab";
const DevicesPanel = dynamic(
    () => import("../device-tab").then((m) => m.DevicesPanel),
    {
        ssr: false,
        loading: () => (
            <div className="grid h-96 place-items-center" role="status">
                <Loader2 className="h-5 w-5 animate-spin" />
                <span className="sr-only">Loading devices</span>
            </div>
        ),
    },
);
export function AccountDevices({
    loading,
    error,
    hasSession,
    onRefresh,
    ...props
}: DevicesPanelProps & {
    loading: boolean;
    error: boolean;
    hasSession: boolean;
    onRefresh: () => void;
}) {
    const message = error
        ? "Account device information could not be loaded. Local sync links are still available."
        : !hasSession
          ? "Sign in to verify account relationships. You can still manage this vault's sync links."
          : !props.isRoot
            ? "Account-wide device management requires root access. You can still manage this vault's sync links."
            : "";
    return (
        <DevicesPanel
            {...props}
            refresh={{ loading, message, available: hasSession, onRefresh }}
        />
    );
}
