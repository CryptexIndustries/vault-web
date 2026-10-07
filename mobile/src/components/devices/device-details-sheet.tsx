import {
    useCallback,
    useEffect,
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
    type ReactNode,
} from "react";
import {
    Pressable,
    useWindowDimensions,
    View,
    type ScrollView,
} from "react-native";
import type { FlatList } from "react-native-gesture-handler";
import {
    FlatList as SheetFlatList,
    ScrollView as SheetScrollView,
} from "react-native-actions-sheet";
import { X } from "lucide-react-native";
import {
    LinkedDevices,
    type LinkedDevice,
} from "@cryptex-industries/vault-core/vault-utils/vault";
import type {
    DeviceNode,
    DeviceRelationship,
    DeviceRelationshipMap,
} from "@/components/account/device-topology";
import type { DeviceConnectionStatus } from "@/components/sync-controller-provider";
import type { DeviceConfigurationDraft } from "./device-configuration-draft";
import {
    DeviceActionError,
    type CompletedDeviceAction,
} from "./device-action-error";
import {
    Information,
    Note,
    DeviceUnlinkButton,
    DeviceConnectionRow,
    DeviceSheetButton as Button,
} from "./device-detail-presentation";
import {
    DeviceAccountAccess,
    DeviceOverview,
    DeviceRelationshipOverview,
} from "./device-overviews";
import {
    DeviceConnectionSettings,
    DeviceServerDetails,
} from "./device-connection-settings";
import {
    DeviceUnlinkContent,
    DeviceUnlinkRecovery,
    DeviceConnectionChoices,
} from "./device-removal-content";
import {
    UnlockedDialogTitle,
    UnlockedText as Text,
} from "@/components/unlocked/unlocked-ui";
import { colors } from "@/theme";

type Selection = { kind: "node" | "edge"; id: string };
type UnlinkView = {
    kind: "unlink";
    nodeId: string;
    relationshipId?: string;
    scope: "connection" | "device";
    chooseConnection: boolean;
};
type SheetView =
    | { kind: "detail" }
    | { kind: "settings" | "servers"; relationshipId: string }
    | UnlinkView
    | { kind: "choose-connection"; target: UnlinkView }
    | {
          kind: "recovery" | "forget";
          target: UnlinkView;
          failed: boolean;
          completed?: CompletedDeviceAction;
          localCleanupRequired?: boolean;
          errorMessage?: string;
          localDevice?: LinkedDevice;
      }
    | { kind: "discard" }
    | { kind: "failure"; title: string; message: string; id?: string };

export type DeviceDetailsProps = {
    open: boolean;
    map: DeviceRelationshipMap;
    selection: Selection;
    connectionStatuses: Record<string, DeviceConnectionStatus>;
    signalingConfig: Pick<
        LinkedDevices,
        "SignalingServers" | "STUNServers" | "TURNServers"
    >;
    isRoot: boolean;
    hasSession: boolean;
    sessionGeneration: number;
    canPromote: boolean;
    pending: boolean;
    onChoose: (selection: Selection) => void;
    onExplore: (nodeId: string) => void;
    onCopy: (id: string) => Promise<void>;
    onSave: (config: DeviceConfigurationDraft) => Promise<void>;
    onConnect: (id: string) => Promise<void>;
    onUnlinkLocal: (device: LinkedDevice, localOnly?: boolean) => Promise<void>;
    onUnlinkRelationship: (relationshipId: string) => Promise<void>;
    onRemoveAccountDevice: (serverId: string) => Promise<void>;
    onToggleRoot: (node: DeviceNode) => void;
    onSuccess: (message: string) => void;
    onClose: () => void;
    onBusyChange?: (busy: boolean) => void;
    onDismissibleChange?: (dismissible: boolean) => void;
    onSheetVariantChange?: (variant: "devices" | "device-detail") => void;
};

function readableError(error: unknown): string | undefined {
    if (!(error instanceof Error)) return undefined;
    const message = error.message.trim();
    if (
        !message ||
        message.length > 360 ||
        /[\r\n]|<html|traceback|\bat [\w.]+\(|^\{|SELECT .* FROM/i.test(message)
    )
        return undefined;
    return message;
}

export function DeviceDetails(props: DeviceDetailsProps) {
    const {
        open,
        map,
        selection,
        connectionStatuses,
        signalingConfig,
        isRoot,
        hasSession,
        sessionGeneration,
        canPromote,
        pending,
        onChoose,
        onExplore,
        onCopy,
        onSave,
        onConnect,
        onUnlinkLocal,
        onUnlinkRelationship,
        onRemoveAccountDevice,
        onToggleRoot,
        onSuccess,
        onClose,
        onBusyChange,
        onDismissibleChange,
        onSheetVariantChange,
    } = props;
    const window = useWindowDimensions();
    const [view, setView] = useState<SheetView>({ kind: "detail" });
    const currentOwner = useRef<{ open: boolean } | null>(null);
    const currentView = useRef(view);
    const [working, setWorking] = useState(false);
    const [informationOpen, setInformationOpen] = useState(false);
    const [bodySize, setBodySize] = useState({ key: "", height: 0 });
    const [draft, setDraft] = useState<DeviceConfigurationDraft | null>(null);
    const [timeout, setTimeout] = useState("30");
    const originalDraft = useRef<DeviceConfigurationDraft | null>(null);
    const history = useRef<{ view: SheetView; scroll: number }[]>([]);
    const scrollRef = useRef<ScrollView>(null);
    const listRef = useRef<FlatList>(null);
    const scrollOffset = useRef(0);
    const restoreOffset = useRef(0);
    const inFlight = useRef(false);
    const busy = pending || working;
    const selectionKey = `${selection.kind}:${selection.id}`;
    const bodyKey = `${selectionKey}:${view.kind}`;
    const bodyKeyRef = useRef(bodyKey);
    bodyKeyRef.current = bodyKey;
    const bodyHeight = bodySize.key === bodyKey ? bodySize.height : 0;
    const measureBody = (_width: number, height: number) => {
        if (bodyKeyRef.current !== bodyKey) return;
        const rounded = Math.ceil(height);
        setBodySize((current) =>
            current.key === bodyKey && current.height === rounded
                ? current
                : { key: bodyKey, height: rounded },
        );
    };

    useLayoutEffect(
        () => () => {
            currentOwner.current = null;
        },
        [],
    );
    useLayoutEffect(() => {
        currentView.current = view;
    }, [view]);
    useLayoutEffect(() => {
        currentOwner.current = { open };
        setView((current) =>
            current.kind === "detail" ? current : { kind: "detail" },
        );
        setInformationOpen(false);
        setDraft(null);
        originalDraft.current = null;
        history.current = [];
        restoreOffset.current = 0;
        scrollOffset.current = 0;
    }, [selectionKey, open, sessionGeneration, hasSession]);
    useEffect(() => {
        onBusyChange?.(working);
        return () => onBusyChange?.(false);
    }, [working, onBusyChange]);

    const node =
        selection.kind === "node"
            ? map.nodes.find((entry) => entry.id === selection.id)
            : undefined;
    const edge =
        selection.kind === "edge"
            ? map.relationships.find((entry) => entry.id === selection.id)
            : undefined;
    const relationshipsFor = (nodeId: string) =>
        map.relationships.filter(
            (entry) =>
                entry.fromDeviceId === nodeId || entry.toDeviceId === nodeId,
        );
    const relationshipById = (id?: string) =>
        map.relationships.find((entry) => entry.id === id);
    const nodeById = (id: string) => map.nodes.find((entry) => entry.id === id);
    const nodeId = node?.id;
    const connections = useMemo(
        () =>
            nodeId
                ? map.relationships.filter(
                      (entry) =>
                          entry.fromDeviceId === nodeId ||
                          entry.toDeviceId === nodeId,
                  )
                : [],
        [map.relationships, nodeId],
    );
    const virtualizedConnections =
        view.kind === "detail" && connections.length > 6;
    useEffect(() => {
        if (virtualizedConnections) {
            listRef.current?.scrollToOffset({
                offset: restoreOffset.current,
                animated: false,
            });
        } else {
            scrollRef.current?.scrollTo({
                y: restoreOffset.current,
                animated: false,
            });
        }
        scrollOffset.current = restoreOffset.current;
    }, [view, virtualizedConnections, selectionKey, open]);
    const overview = view.kind === "detail";
    useEffect(() => {
        onSheetVariantChange?.(overview ? "device-detail" : "devices");
    }, [overview, onSheetVariantChange]);
    const go = useCallback(
        (next: SheetView) => {
            if (busy) return;
            history.current.push({ view, scroll: scrollOffset.current });
            restoreOffset.current = 0;
            setView(next);
        },
        [busy, view],
    );
    const copy = useCallback(
        async (id: string) => {
            const startedBy = currentOwner.current;
            if (!startedBy?.open) return false;
            const startedView = currentView.current;
            const isCurrent = () =>
                currentOwner.current === startedBy &&
                currentView.current === startedView;
            try {
                await onCopy(id);
                return isCurrent();
            } catch (error) {
                if (!isCurrent()) return false;
                throw error;
            }
        },
        [onCopy],
    );
    const copyError = useCallback(
        (id: string) =>
            go({
                kind: "failure",
                title: "Could not copy ID",
                message: "Select the ID below to copy it manually.",
                id,
            }),
        [go],
    );
    const back = () => {
        if (busy) return;
        const previous = history.current.pop();
        restoreOffset.current = previous?.scroll ?? 0;
        setView(previous?.view ?? { kind: "detail" });
    };
    const dirty =
        !!draft &&
        (JSON.stringify(draft) !== JSON.stringify(originalDraft.current) ||
            timeout !== String(originalDraft.current?.SyncTimeoutPeriod || 30));
    useEffect(() => {
        onDismissibleChange?.(!working && !dirty && view.kind !== "discard");
        return () => onDismissibleChange?.(true);
    }, [working, view.kind, dirty, onDismissibleChange]);
    const requestBack = () => {
        if (busy) return;
        if (view.kind === "detail") onClose();
        else if (view.kind === "settings" && dirty) go({ kind: "discard" });
        else back();
    };
    const run = useCallback(
        async (
            action: () => Promise<void>,
            failure: SheetView,
            completed?: () => void,
        ) => {
            const startedBy = currentOwner.current;
            if (busy || inFlight.current || !startedBy?.open) return;
            const isCurrent = () => currentOwner.current === startedBy;
            inFlight.current = true;
            setWorking(true);
            try {
                await action();
                if (isCurrent()) completed?.();
            } catch (error) {
                if (!isCurrent()) return;
                history.current.push({ view, scroll: scrollOffset.current });
                restoreOffset.current = 0;
                setView(
                    failure.kind === "recovery"
                        ? {
                              ...failure,
                              completed:
                                  error instanceof DeviceActionError
                                      ? error.completedAction
                                      : undefined,
                              localCleanupRequired:
                                  error instanceof DeviceActionError
                                      ? error.localCleanupRequired
                                      : undefined,
                              errorMessage: readableError(error),
                          }
                        : failure.kind === "failure"
                          ? {
                                ...failure,
                                message:
                                    readableError(error) ?? failure.message,
                            }
                          : failure,
                );
            } finally {
                inFlight.current = false;
                if (currentOwner.current) setWorking(false);
            }
        },
        [busy, view],
    );
    const connect = useCallback(
        (local: LinkedDevice) => {
            void run(() => onConnect(local.ID), {
                kind: "failure",
                title: "Could not connect",
                message:
                    "Check this connection's server settings and try again when both devices are online and unlocked.",
            });
        },
        [onConnect, run],
    );
    const canUnlinkConnection = (relationship?: DeviceRelationship) => {
        if (!relationship) return false;
        if (relationship.localDevice) {
            if (!LinkedDevices.isUsingOnlineServices(relationship.localDevice))
                return true;
            return (
                hasSession &&
                !!relationship.syncId &&
                !relationship.missingOnServer
            );
        }
        return (
            isRoot &&
            map.topologyVerified &&
            relationship.recordedOnServer &&
            !!relationship.syncId
        );
    };
    const openUnlink = useCallback(
        (target: DeviceNode, relationship?: DeviceRelationship) => {
            const candidates = map.relationships.filter(
                (entry) =>
                    entry.fromDeviceId === target.id ||
                    entry.toDeviceId === target.id,
            );
            go({
                kind: "unlink",
                nodeId: target.id,
                relationshipId:
                    relationship?.id ??
                    (candidates.length === 1 ? candidates[0].id : undefined),
                scope:
                    relationship || candidates.length ? "connection" : "device",
                chooseConnection: !relationship,
            });
        },
        [go, map.relationships],
    );
    const openRelationship = useCallback(
        (relationship: DeviceRelationship) => {
            onChoose({ kind: "edge", id: relationship.id });
        },
        [onChoose],
    );
    const targetFor = (relationship: DeviceRelationship) =>
        nodeById(
            relationship.fromDeviceId === map.currentDeviceId
                ? relationship.toDeviceId
                : relationship.toDeviceId === map.currentDeviceId
                  ? relationship.fromDeviceId
                  : relationship.toDeviceId,
        );
    const openSettings = useCallback(
        (relationship: DeviceRelationship) => {
            const local = relationship.localDevice;
            if (!local) return;
            const next = {
                ID: local.ID,
                Name: local.Name,
                AutoConnect: local.AutoConnect,
                AutoSync: local.AutoSync,
                SyncTimeout: local.SyncTimeout,
                SyncTimeoutPeriod: local.SyncTimeoutPeriod || 30,
            };
            setDraft(next);
            originalDraft.current = next;
            setTimeout(String(next.SyncTimeoutPeriod));
            go({ kind: "settings", relationshipId: relationship.id });
        },
        [go],
    );
    const openServers = useCallback(
        (relationship: DeviceRelationship) =>
            go({ kind: "servers", relationshipId: relationship.id }),
        [go],
    );
    const save = () => {
        if (!draft) return;
        const period = Number(timeout);
        if (!draft.Name.trim()) {
            go({
                kind: "failure",
                title: "Device name is required",
                message:
                    "Enter a display name before saving these connection settings.",
            });
            return;
        }
        if (draft.SyncTimeout && (!Number.isInteger(period) || period < 1)) {
            go({
                kind: "failure",
                title: "Check the timeout",
                message: "Use a whole number of seconds greater than 0.",
            });
            return;
        }
        const next = {
            ...draft,
            Name: draft.Name.trim(),
            SyncTimeoutPeriod:
                Number.isInteger(period) && period > 0
                    ? period
                    : draft.SyncTimeoutPeriod,
        };
        void run(
            () => onSave(next),
            {
                kind: "failure",
                title: "Could not save settings",
                message:
                    "Your changes have been kept here. Return to settings and try saving again.",
            },
            () => {
                setDraft(null);
                originalDraft.current = null;
                onSuccess("Connection settings saved.");
                if (view.kind === "discard") history.current.pop();
                const previous = history.current.pop();
                restoreOffset.current = previous?.scroll ?? 0;
                setView(previous?.view ?? { kind: "detail" });
            },
        );
    };
    let title = "Device details";
    let body: ReactNode = null;
    let footer: ReactNode = null;

    if (view.kind === "detail" && node) {
        body = (
            <DeviceOverview
                node={node}
                map={map}
                connectionStatuses={connectionStatuses}
                pending={busy}
                working={working}
                isRoot={isRoot}
                canPromote={canPromote}
                activityMinute={Math.floor(Date.now() / 60_000)}
                onExplore={onExplore}
                onCopy={copy}
                onCopyError={copyError}
                onChoose={onChoose}
                onConnect={connect}
                onToggleRoot={onToggleRoot}
                onUnlink={openUnlink}
                headerOnly={virtualizedConnections}
            />
        );
        if (
            node.serverId &&
            isRoot &&
            map.topologyVerified &&
            !node.current &&
            !node.root
        )
            footer = (
                <DeviceUnlinkButton
                    testID="device-remove-account"
                    pending={busy}
                    onPress={() => openUnlink(node)}
                />
            );
    } else if (view.kind === "detail" && edge) {
        title = "Connection";
        body = (
            <DeviceRelationshipOverview
                edge={edge}
                map={map}
                connectionStatuses={connectionStatuses}
                pending={busy}
                working={working}
                onChoose={onChoose}
                onCopy={copy}
                onCopyError={copyError}
                onConnect={connect}
                onSettings={openSettings}
                onServers={openServers}
                informationOpen={informationOpen}
                onInformationChange={setInformationOpen}
            />
        );
        footer = (
            <DeviceUnlinkButton
                testID="device-unlink"
                pending={busy}
                onPress={() => {
                    const target = targetFor(edge);
                    if (target) openUnlink(target, edge);
                }}
            />
        );
    } else if (view.kind === "detail") {
        const subject = selection.kind === "edge" ? "connection" : "device";
        title = selection.kind === "edge" ? "Connection" : "Device details";
        body = (
            <Note>
                This {subject} is no longer available. Close these details and
                select another {subject}.
            </Note>
        );
    } else if (view.kind === "servers") {
        title = "Connection servers";
        const local = relationshipById(view.relationshipId)?.localDevice;
        body = local ? (
            <DeviceServerDetails
                local={local}
                signalingConfig={signalingConfig}
            />
        ) : null;
        footer = (
            <Button variant="secondary" disabled={busy} onPress={back}>
                Back to details
            </Button>
        );
    } else if (view.kind === "settings" && draft) {
        title = "Name and sync settings";
        body = (
            <DeviceConnectionSettings
                draft={draft}
                local={relationshipById(view.relationshipId)?.localDevice}
                timeout={timeout}
                pending={busy}
                onDraftChange={setDraft}
                onTimeoutChange={setTimeout}
            />
        );
        footer = (
            <>
                <Button
                    testID="device-save-settings"
                    disabled={busy}
                    loading={working}
                    onPress={save}
                >
                    Save changes
                </Button>
                <Button
                    testID="device-cancel-settings"
                    variant="secondary"
                    disabled={busy}
                    onPress={requestBack}
                >
                    Cancel
                </Button>
            </>
        );
    } else if (view.kind === "unlink") {
        title = "Unlink";
        const target = nodeById(view.nodeId);
        const relationship = relationshipById(view.relationshipId);
        const local = relationship?.localDevice;
        const candidates = relationshipsFor(view.nodeId);
        const whole = view.scope === "device";
        const canRemoveDevice =
            !!target?.serverId &&
            isRoot &&
            map.topologyVerified &&
            !target.current &&
            !target.root;
        const allowed = whole
            ? canRemoveDevice
            : canUnlinkConnection(relationship);
        body = (
            <DeviceUnlinkContent
                target={target}
                relationship={relationship}
                candidates={candidates}
                map={map}
                chooseConnection={view.chooseConnection}
                scope={view.scope}
                pending={busy}
                isRoot={isRoot}
                hasSession={hasSession}
                allowed={allowed}
                onScopeChange={(scope) => setView({ ...view, scope })}
                onChooseConnection={() =>
                    go({ kind: "choose-connection", target: view })
                }
            />
        );
        footer = (
            <>
                <Button
                    testID="device-confirm-unlink"
                    variant="default"
                    disabled={busy || !allowed}
                    loading={working}
                    onPress={() => {
                        void run(
                            async () => {
                                if (whole && target?.serverId)
                                    await onRemoveAccountDevice(
                                        target.serverId,
                                    );
                                else if (relationship?.localDevice)
                                    await onUnlinkLocal(
                                        relationship.localDevice,
                                        false,
                                    );
                                else if (relationship)
                                    await onUnlinkRelationship(relationship.id);
                            },
                            {
                                kind: "recovery",
                                target: view,
                                failed: true,
                                localDevice: local,
                            },
                            () => {
                                onSuccess(
                                    whole
                                        ? "Device removed from Online Services."
                                        : "Connection unlinked.",
                                );
                                onClose();
                            },
                        );
                    }}
                >
                    {whole
                        ? "Remove from Online Services"
                        : local && !LinkedDevices.isUsingOnlineServices(local)
                          ? "Unlink from this vault"
                          : "Unlink devices"}
                </Button>
                {!whole && local && relationship?.missingOnServer ? (
                    <Button
                        testID="device-unlink-recovery"
                        variant="secondary"
                        disabled={busy}
                        onPress={() =>
                            go({
                                kind: "recovery",
                                target: view,
                                failed: false,
                            })
                        }
                    >
                        Recovery options
                    </Button>
                ) : null}
                <Button
                    testID="device-cancel-unlink"
                    variant="secondary"
                    disabled={busy}
                    onPress={back}
                >
                    Cancel
                </Button>
            </>
        );
    } else if (view.kind === "choose-connection") {
        title = "Choose a connection";
        const target = nodeById(view.target.nodeId);
        body = target ? (
            <DeviceConnectionChoices
                target={target}
                candidates={relationshipsFor(target.id)}
                map={map}
                connectionStatuses={connectionStatuses}
                pending={busy}
                selectedId={view.target.relationshipId}
                onSelect={(relationship) => {
                    history.current.pop();
                    setView({
                        ...view.target,
                        relationshipId: relationship.id,
                    });
                }}
            />
        ) : null;
        footer = (
            <Button
                testID="device-cancel-connection-choice"
                variant="secondary"
                disabled={busy}
                onPress={back}
            >
                Cancel
            </Button>
        );
    } else if (view.kind === "recovery") {
        title =
            view.completed === "device-removed"
                ? "Device removed"
                : view.completed === "connection-unlinked"
                  ? "Connection unlinked"
                  : view.failed
                    ? view.target.scope === "device"
                        ? "Could not remove device"
                        : "Could not unlink connection"
                    : "Connection no longer registered";
        const relationship = relationshipById(view.target.relationshipId);
        const local = relationship?.localDevice ?? view.localDevice;
        const canForget =
            view.target.scope === "connection" &&
            !!local &&
            (!view.completed || !!view.localCleanupRequired);
        body = (
            <DeviceUnlinkRecovery
                completed={view.completed}
                scope={view.target.scope}
                failed={view.failed}
                canForget={canForget}
                errorMessage={view.errorMessage}
                localCleanupRequired={view.localCleanupRequired}
            />
        );
        footer = (
            <>
                {view.failed && !view.completed ? (
                    <Button
                        testID="device-retry-unlink"
                        disabled={busy}
                        onPress={back}
                    >
                        Retry
                    </Button>
                ) : null}
                {canForget ? (
                    <Button
                        testID="device-forget-locally"
                        variant="secondary"
                        disabled={busy}
                        onPress={() =>
                            go({ ...view, kind: "forget", localDevice: local })
                        }
                    >
                        Forget locally
                    </Button>
                ) : null}
                <Button
                    testID="device-cancel-recovery"
                    variant="secondary"
                    disabled={busy}
                    onPress={view.completed ? onClose : back}
                >
                    {view.completed === "device-removed"
                        ? "Review saved connections"
                        : view.completed
                          ? "Close"
                          : "Cancel"}
                </Button>
            </>
        );
    } else if (view.kind === "forget") {
        title = "Forget this connection?";
        const relationship = relationshipById(view.target.relationshipId);
        const local = relationship?.localDevice ?? view.localDevice;
        body = (
            <>
                <Information
                    label="Relationship ID"
                    value={relationship?.syncId || "Not available"}
                    mono
                />
                <Text style={{ fontSize: 13, lineHeight: 21 }}>
                    Remove only this vault's saved link and settings. Any Online
                    Services relationship may remain. Vault contents remain on
                    both devices.
                </Text>
            </>
        );
        footer = (
            <>
                <Button
                    testID="device-confirm-forget"
                    variant="default"
                    disabled={busy || !local}
                    loading={working}
                    onPress={() => {
                        if (!local) return;
                        void run(
                            () => onUnlinkLocal(local, true),
                            {
                                kind: "failure",
                                title: "Could not forget connection",
                                message:
                                    "The saved link was kept. Try again after checking that this vault can save changes.",
                            },
                            () => {
                                onSuccess(
                                    "Saved connection forgotten locally.",
                                );
                                onClose();
                            },
                        );
                    }}
                >
                    Forget locally
                </Button>
                <Button
                    testID="device-cancel-forget"
                    variant="secondary"
                    disabled={busy}
                    onPress={back}
                >
                    Cancel
                </Button>
            </>
        );
    } else if (view.kind === "discard") {
        title = "Save connection settings?";
        body = <Note>You have unsaved changes.</Note>;
        footer = (
            <>
                <Button disabled={busy} loading={working} onPress={save}>
                    Save changes
                </Button>
                <Button variant="outline" disabled={busy} onPress={back}>
                    Keep editing
                </Button>
                <Button
                    testID="device-discard-settings"
                    variant="ghost"
                    disabled={busy}
                    onPress={() => {
                        setDraft(null);
                        originalDraft.current = null;
                        history.current.pop();
                        back();
                    }}
                >
                    Discard changes
                </Button>
            </>
        );
    } else if (view.kind === "failure") {
        title = view.title;
        body = (
            <>
                <Text style={{ fontSize: 13, lineHeight: 21 }}>
                    {view.message}
                </Text>
                {view.id ? (
                    <Information label="ID" value={view.id} mono />
                ) : null}
            </>
        );
        footer = (
            <Button
                testID="device-dismiss-error"
                variant="outline"
                disabled={busy}
                onPress={back}
            >
                Back
            </Button>
        );
    }

    return (
        <View style={{ flexShrink: 1, minHeight: 0 }}>
            <View
                style={{
                    minHeight: 42,
                    flexDirection: "row",
                    alignItems: "center",
                    marginBottom: 12,
                    paddingHorizontal: overview ? 18 : 0,
                }}
            >
                <UnlockedDialogTitle
                    style={{
                        flex: 1,
                        fontSize: overview ? 23 : 24,
                        letterSpacing: -0.5,
                        lineHeight: overview ? 28 : 29,
                    }}
                >
                    {title}
                </UnlockedDialogTitle>
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={overview ? "Close details" : "Back"}
                    testID={
                        overview ? "device-close-details" : "device-detail-back"
                    }
                    disabled={busy}
                    onPress={requestBack}
                    style={{
                        minWidth: 42,
                        minHeight: 42,
                        alignItems: "center",
                        justifyContent: "center",
                    }}
                >
                    <X size={21} color={colors.muted} />
                </Pressable>
            </View>
            {virtualizedConnections && node ? (
                <SheetFlatList
                    ref={listRef}
                    testID="device-details-body"
                    data={connections}
                    keyExtractor={(relationship) => relationship.id}
                    initialNumToRender={4}
                    maxToRenderPerBatch={4}
                    windowSize={3}
                    updateCellsBatchingPeriod={50}
                    ListHeaderComponent={<>{body}</>}
                    ListFooterComponent={
                        <DeviceAccountAccess
                            node={node}
                            map={map}
                            pending={busy}
                            isRoot={isRoot}
                            canPromote={canPromote}
                            onToggleRoot={onToggleRoot}
                        />
                    }
                    renderItem={({ item }) => (
                        <DeviceConnectionRow
                            relationship={item}
                            owner={node}
                            map={map}
                            status={
                                item.localDevice
                                    ? connectionStatuses[item.localDevice.ID]
                                    : undefined
                            }
                            pending={busy}
                            onOpen={openRelationship}
                            onUnlink={openUnlink}
                        />
                    )}
                    style={{
                        // The Dialog cap and flex shrink define this viewport.
                        // Row estimates must not resize it as batches mount.
                        height: window.height,
                        flexGrow: 0,
                        flexShrink: 1,
                        minHeight: 0,
                    }}
                    contentContainerStyle={{ paddingHorizontal: 20 }}
                    keyboardShouldPersistTaps="handled"
                    showsVerticalScrollIndicator={false}
                    scrollEventThrottle={16}
                    onScroll={(event) => {
                        scrollOffset.current =
                            event.nativeEvent.contentOffset.y;
                    }}
                />
            ) : (
                <SheetScrollView
                    ref={scrollRef}
                    testID="device-details-body"
                    style={{
                        height: bodyHeight || undefined,
                        flexGrow: 0,
                        flexShrink: 1,
                        minHeight: 0,
                    }}
                    onContentSizeChange={measureBody}
                    contentContainerStyle={{
                        paddingHorizontal: overview ? 20 : 0,
                    }}
                    keyboardShouldPersistTaps="handled"
                    showsVerticalScrollIndicator={false}
                    scrollEventThrottle={16}
                    onScroll={(event) => {
                        scrollOffset.current =
                            event.nativeEvent.contentOffset.y;
                    }}
                >
                    {body}
                </SheetScrollView>
            )}
            {footer ? (
                <View
                    testID="device-details-footer"
                    style={
                        overview
                            ? {
                                  paddingTop: 7,
                                  paddingHorizontal: 20,
                                  paddingBottom: 15,
                              }
                            : {
                                  paddingTop: view.kind === "servers" ? 10 : 18,
                                  gap: 10,
                              }
                    }
                >
                    {footer}
                </View>
            ) : null}
        </View>
    );
}
