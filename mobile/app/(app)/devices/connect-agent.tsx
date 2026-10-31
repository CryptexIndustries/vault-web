import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { router } from "expo-router";
import { useIsFocused } from "expo-router/react-navigation";
import {
    CameraView,
    useCameraPermissions,
    type BarcodeScanningResult,
} from "expo-camera";
import { useAtomValue } from "jotai";
import { t } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { QrCode } from "lucide-react-native";
import {
    agentKeyOptions,
    offerMachineLabel,
    relayLabel,
} from "@cryptex-industries/vault-core/agent/agent-format";
import type { ClaimedPairing } from "@cryptex-industries/vault-core/agent/approver-types";
import {
    PairingExpiredError,
    RelayRefusedError,
    UnknownRelayError,
} from "@cryptex-industries/vault-core/agent/approver";
import { InvalidPairingCodeError } from "@cryptex-industries/vault-core/agent/pairing";
import { RelayStatusError } from "@cryptex-industries/vault-core/agent/relay-client";
import {
    NAME_LENGTH,
    sanitizeDisplayText,
} from "@cryptex-industries/vault-core/agent/request-check";
import { normalizeRelayUrlInput } from "@cryptex-industries/vault-core/agent/runtime";
import {
    connectedAgentFromPairing,
    grantedKeyInputs,
    sshKeyItems,
} from "@cryptex-industries/vault-core/agent/vault-agents";

import { InvitationHeader } from "@/components/invitation-header";
import { InlineNotice } from "@/components/inline-notice";
import { Dialog, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
    UnlockedButton as Button,
    UnlockedInput as Input,
    UnlockedLabel as Label,
    UnlockedTaskScreen,
    UnlockedText as Text,
} from "@/components/unlocked/unlocked-ui";
import { useUnlockedSnackbar } from "@/components/unlocked/unlocked-snackbar";
import { InfoCard, KeyPickerList } from "@/components/agents/agent-rows";
import {
    agentRuntime,
    approverDeviceName,
    syncAgentCache,
} from "@/agent/agent-app";
import {
    loadApproverIdentity,
    loadCustomRelays,
    saveCustomRelay,
} from "@/agent/agent-storage";
import { addAgentToVault } from "@/agent/agent-vault";
import {
    hostedRelayRefusedMessage,
    refusedRelayMessage,
    unknownRelayMessage,
} from "@/agent/relay-wording";
import { requestNotificationPermission } from "@/agent/agent-service";
import { sshKeyInfo } from "@/utils/ssh-keys";
import { unlockedVaultAtom } from "@/utils/atoms";
import { colors } from "@/theme";

type Stage = "scan" | "offer" | "code";

function claimError(error: unknown): string {
    if (error instanceof InvalidPairingCodeError)
        return t`That isn't a cryptex-agent pairing code.`;
    if (error instanceof PairingExpiredError)
        return t`The pairing code expired. Run cryptex-agent pair again.`;
    if (error instanceof RelayStatusError)
        return t`The code expired or was already used. Run cryptex-agent pair again.`;
    return t`Couldn't reach the relay. Check your connection and try again.`;
}

export default function ConnectAgentScreen() {
    const { t } = useLingui();
    const vault = useAtomValue(unlockedVaultAtom);
    const showSnackbar = useUnlockedSnackbar();
    const isFocused = useIsFocused();
    const [permission, requestPermission] = useCameraPermissions();
    const [stage, setStage] = useState<Stage>("scan");
    const [pasteOpen, setPasteOpen] = useState(false);
    const [pasteDraft, setPasteDraft] = useState("");
    const [busy, setBusy] = useState(false);
    const [claim, setClaim] = useState<ClaimedPairing | null>(null);
    const [pendingCode, setPendingCode] = useState("");
    const [relayNeeded, setRelayNeeded] = useState<string | null>(null);
    const [relayToken, setRelayToken] = useState("");
    /** The relay refused the token saved for it, rather than being unknown. */
    const [relayRefused, setRelayRefused] = useState(false);
    /** A failed claim from the Paste code sheet, shown in the sheet. */
    const [pasteError, setPasteError] = useState("");
    /** Relays of the user's own already saved here, for the unknown relay warning. */
    const [savedRelays, setSavedRelays] = useState<string[]>([]);
    const [name, setName] = useState("");
    const [selected, setSelected] = useState<string[]>([]);
    const [confirmation, setConfirmation] = useState("");
    const scanned = useRef(false);
    const endPairing = useRef<(() => void) | null>(null);
    /** The vault save of a confirmed agent, while it runs. */
    const saving = useRef<Promise<boolean> | null>(null);
    /** Cancel was pressed, or the screen left: a late confirmation must not save. */
    const cancelled = useRef(false);
    /** Bumped by each Connect and by Back on the offer: older attempts stop. */
    const attempt = useRef(0);
    /**
     * After the agent confirms: "saving" once the vault save starts (no
     * cancelling from there), "sync-failed" if the agent is saved but this
     * phone couldn't start serving it.
     */
    const [phase, setPhase] = useState<"waiting" | "saving" | "sync-failed">(
        "waiting",
    );
    const [savedId, setSavedId] = useState<string | null>(null);
    /** The paired agent's page, opened once this screen has focus again. */
    const [pairedId, setPairedId] = useState<string | null>(null);

    useEffect(() => {
        let ended = false;
        void agentRuntime.beginPairing().then((end) => {
            if (ended) end();
            else endPairing.current = end;
        });
        return () => {
            ended = true;
            cancelled.current = true;
            // A save underway decides first: the runtime keeps a saved agent
            // and unregisters one that wasn't.
            const end = endPairing.current;
            if (saving.current) void saving.current.finally(() => end?.());
            else end?.();
        };
    }, []);

    useEffect(() => {
        if (
            stage === "scan" &&
            permission &&
            !permission.granted &&
            permission.canAskAgain
        )
            void requestPermission();
    }, [permission, requestPermission, stage]);

    // The agent's first request can open the approval screen over this one
    // before the vault save ends. Replacing then would replace that screen
    // and hide the request, so move on only once this screen is on top.
    useEffect(() => {
        if (!pairedId || !isFocused) return;
        router.replace({
            pathname: "/(app)/devices/agents/[id]",
            params: { id: pairedId },
        });
    }, [isFocused, pairedId]);

    const keys = useMemo(
        () => agentKeyOptions(sshKeyItems(vault), sshKeyInfo, t`SSH key`),
        [vault, t],
    );

    const submitCode = useCallback(
        async (text: string) => {
            if (busy) return;
            setBusy(true);
            try {
                const claimed = await agentRuntime.claim(text);
                setClaim(claimed);
                setName(
                    sanitizeDisplayText(
                        claimed.offer.hostname ||
                            t({
                                message: "agent",
                                comment:
                                    "Default name for a new agent when its machine reports no hostname; the user can edit it",
                            }),
                        NAME_LENGTH,
                    ),
                );
                setSelected(keys.length === 1 ? [keys[0]!.id] : []);
                setRelayNeeded(null);
                setPasteOpen(false);
                setStage("offer");
            } catch (error) {
                // An unknown relay, or one of ours whose access token changed:
                // both ask for a token.
                const tokenRelay =
                    error instanceof UnknownRelayError
                        ? error.relayUrl
                        : error instanceof RelayRefusedError &&
                            error.relay.kind === "custom"
                          ? error.relay.url
                          : null;
                if (tokenRelay) {
                    setPendingCode(text);
                    // Never prefill: a token belongs to the relay it was saved for.
                    setRelayToken("");
                    setSavedRelays(
                        (await loadCustomRelays().catch(() => [])).map(
                            (relay) => relay.origin,
                        ),
                    );
                    setRelayRefused(!(error instanceof UnknownRelayError));
                    setRelayNeeded(tokenRelay);
                    setPasteOpen(false);
                } else {
                    const message =
                        error instanceof RelayRefusedError
                            ? hostedRelayRefusedMessage()
                            : claimError(error);
                    // The Paste code sheet would cover a snackbar.
                    if (pasteOpen) setPasteError(message);
                    else showSnackbar(message);
                    scanned.current = false;
                }
            } finally {
                setBusy(false);
            }
        },
        [busy, keys, pasteOpen, showSnackbar, t],
    );

    const saveRelayAndRetry = async () => {
        const origin = relayNeeded ? normalizeRelayUrlInput(relayNeeded) : null;
        if (!origin) {
            showSnackbar(t`This relay needs an https:// address.`);
            return;
        }
        if (!relayToken.trim()) return;
        try {
            await saveCustomRelay({ origin, token: relayToken.trim() });
            await agentRuntime.reload();
        } catch {
            showSnackbar(t`Couldn't save the relay token on this phone.`);
            return;
        }
        setRelayToken("");
        await submitCode(pendingCode);
    };

    const onBarcodeScanned = (result: BarcodeScanningResult) => {
        if (scanned.current || busy || stage !== "scan") return;
        scanned.current = true;
        void submitCode(result.data);
    };

    const connect = async () => {
        if (!claim || busy) return;
        const agentName = sanitizeDisplayText(name.trim(), NAME_LENGTH);
        const chosen = sshKeyItems(vault).filter((item) =>
            selected.includes(item.ID),
        );
        const current = ++attempt.current;
        // Checked after every wait: Back on the offer, Cancel or leaving ends
        // this attempt, and nothing of it may be saved afterwards.
        const live = () => attempt.current === current && !cancelled.current;
        setBusy(true);
        let answered = false;
        try {
            // Requests reach a closed or locked app only as notifications;
            // Connect is the moment to ask (Android 13 and later).
            await requestNotificationPermission().catch(() => false);
            if (!live()) return;
            const result = await agentRuntime.accept(claim, {
                agentName,
                keys: grantedKeyInputs(chosen),
            });
            if (!live()) {
                // The relay registration came after the user backed out.
                await agentRuntime
                    .unregister(claim.agentId)
                    .catch(() => undefined);
                return;
            }
            setConfirmation(result.confirmationCode);
            answered = true;
            setPhase("waiting");
            setStage("code");
            await agentRuntime.waitForConfirmation(claim.agentId);
            if (!live()) return;
            // From here the save runs to the end; Cancel is off.
            setPhase("saving");
            const record = await connectedAgentFromPairing({
                claim,
                result,
                agentName,
                credentialIds: chosen.map((item) => item.ID),
                identity: await loadApproverIdentity(),
                approverName: approverDeviceName(),
            });
            saving.current = addAgentToVault(record);
            const saved = await saving.current.finally(() => {
                saving.current = null;
            });
            if (!saved)
                throw new Error("Couldn't save the agent in your vault.");
            setSavedId(record.ID);
            await finishPairing(record.ID);
        } catch (error) {
            if (!live()) return;
            // A request that came after the confirmation waited for the save.
            if (answered) agentRuntime.pairingFailed(claim.agentId);
            showSnackbar(
                error instanceof PairingExpiredError
                    ? t`The pairing code expired. Run cryptex-agent pair again.`
                    : answered
                      ? t`The agent didn't confirm the pairing.`
                      : t`Couldn't connect the agent. Try again.`,
            );
            setStage("scan");
            setClaim(null);
            scanned.current = false;
        } finally {
            if (attempt.current === current) setBusy(false);
        }
    };

    /**
     * Leaving this screen ends the pairing hold, and the runtime refuses the
     * requests of an agent it doesn't serve by then. So stay until the cache
     * lists the agent and the runtime has reloaded it; on failure offer a
     * retry.
     */
    const finishPairing = async (id: string) => {
        setBusy(true);
        try {
            await syncAgentCache();
        } catch {
            setPhase("sync-failed");
            return;
        } finally {
            setBusy(false);
        }
        showSnackbar(
            t({
                message: "Connected",
                comment: "Snackbar after an SSH agent is paired",
            }),
        );
        setPairedId(id);
    };

    const cancelPairing = async () => {
        if (phase !== "waiting") return;
        cancelled.current = true;
        if (claim && stage === "code")
            await agentRuntime.unregister(claim.agentId).catch(() => undefined);
        router.back();
    };

    if (stage === "code" && claim) {
        const footer =
            phase === "sync-failed" ? (
                <View className="gap-3">
                    <Button
                        testID="agent-sync-retry"
                        loading={busy}
                        loadingLabel={t`Trying again…`}
                        onPress={() => savedId && void finishPairing(savedId)}
                    >
                        {t`Try again`}
                    </Button>
                    <Button
                        variant="outline"
                        disabled={busy}
                        onPress={() => router.back()}
                    >
                        {t`Close`}
                    </Button>
                </View>
            ) : (
                <Button
                    variant="outline"
                    loading={phase === "saving"}
                    loadingLabel={t`Saving…`}
                    onPress={() => void cancelPairing()}
                >
                    {t`Cancel`}
                </Button>
            );
        const machineName = sanitizeDisplayText(claim.offer.hostname || "");
        const spelledCode = confirmation.split("").join(" ");
        return (
            <UnlockedTaskScreen
                title={t`Connect an agent`}
                onBack={
                    phase === "waiting"
                        ? () => void cancelPairing()
                        : phase === "sync-failed"
                          ? () => !busy && router.back()
                          : () => undefined
                }
                footer={footer}
            >
                <View className="w-full max-w-[480px] self-center">
                    <InvitationHeader title={t`Check the code`}>
                        {machineName
                            ? t`The terminal on ${machineName} should show the same code. Press Enter there if it matches.`
                            : t`The terminal on the machine should show the same code. Press Enter there if it matches.`}
                    </InvitationHeader>
                    <View
                        className="my-4 items-center rounded-xl border border-border bg-secondary py-5"
                        accessibilityLabel={t`Confirmation code ${spelledCode}`}
                    >
                        <Text
                            testID="agent-code"
                            className="font-mono"
                            style={{ fontSize: 32, letterSpacing: 3 }}
                            selectable
                        >
                            {confirmation}
                        </Text>
                    </View>
                    {phase === "sync-failed" ? (
                        <InlineNotice
                            tone="error"
                            message={t`The agent is saved in your vault, but this phone couldn't start answering it. Try again. If you close, it starts the next time you unlock.`}
                        />
                    ) : (
                        <InlineNotice
                            tone="loading"
                            message={
                                phase === "saving"
                                    ? t`Saving the agent in your vault…`
                                    : t`Waiting for the agent…`
                            }
                        />
                    )}
                </View>
            </UnlockedTaskScreen>
        );
    }

    if (stage === "offer" && claim) {
        const offer = claim.offer;
        const relayHost = relayLabel(
            claim.relay.kind === "hosted" ? "" : claim.relay.url,
            t`Online Services`,
        );
        return (
            <UnlockedTaskScreen
                title={t`Connect an agent`}
                onBack={() => {
                    // Also ends a Connect still waiting for the relay.
                    attempt.current++;
                    setBusy(false);
                    setStage("scan");
                    setClaim(null);
                    scanned.current = false;
                }}
                scroll={false}
                footer={
                    <View style={{ gap: 12 }}>
                        {selected.length ? null : (
                            <InlineNotice
                                tone="warning"
                                testID="agent-no-keys"
                                message={
                                    keys.length
                                        ? t`This agent can't use any keys yet. You can add them later with Edit keys on its page.`
                                        : t`Your vault has no SSH keys yet. You can connect the agent now and add keys later with Edit keys on its page.`
                                }
                            />
                        )}
                        <Button
                            testID="agent-submit"
                            disabled={!name.trim()}
                            loading={busy}
                            loadingLabel={t`Connecting…`}
                            onPress={() => void connect()}
                        >
                            {t({
                                message: "Connect",
                                context: "button: pair the SSH agent",
                            })}
                        </Button>
                    </View>
                }
            >
                <KeyPickerList
                    keys={keys}
                    selected={selected}
                    onChange={setSelected}
                    disabled={busy}
                    maxWidth={480}
                    title={t`Keys this agent can use`}
                    labelStyle={{ marginTop: 22 }}
                    header={
                        <>
                            <InfoCard
                                label={t`Machine, as reported by the machine`}
                                value={offerMachineLabel(
                                    offer,
                                    t`Unknown machine`,
                                )}
                            />
                            <InfoCard
                                label={t`Agent`}
                                value={`cryptex-agent ${sanitizeDisplayText(offer.agentVersion || "", 32)}, ${relayHost}`}
                            />
                            <View style={{ marginTop: 6, gap: 8 }}>
                                <Label>{t`Name`}</Label>
                                <Input
                                    testID="agent-name"
                                    value={name}
                                    onChangeText={setName}
                                    maxLength={NAME_LENGTH}
                                    autoCapitalize="none"
                                    autoCorrect={false}
                                    accessibilityLabel={t`Agent name`}
                                />
                            </View>
                        </>
                    }
                />
            </UnlockedTaskScreen>
        );
    }

    const cameraActive =
        !!permission?.granted && isFocused && !relayNeeded && !pasteOpen;
    return (
        <UnlockedTaskScreen title={t`Connect an agent`}>
            <View className="w-full max-w-[480px] gap-4 self-center">
                <InvitationHeader title={t`Scan the pairing code`}>
                    {t`Point the camera at the code in your terminal.`}
                </InvitationHeader>
                <View
                    testID="agent-scan"
                    className="aspect-square w-full overflow-hidden rounded-md border border-border bg-[#111520]"
                >
                    {cameraActive ? (
                        <CameraView
                            style={{ width: "100%", height: "100%" }}
                            facing="back"
                            barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
                            onBarcodeScanned={onBarcodeScanned}
                        />
                    ) : (
                        <View className="flex-1 items-center justify-center">
                            <QrCode size={56} color={colors.primary} />
                        </View>
                    )}
                    {busy ? (
                        <View
                            style={{
                                position: "absolute",
                                inset: 0,
                                alignItems: "center",
                                justifyContent: "center",
                                backgroundColor: "rgba(17,21,32,0.7)",
                            }}
                        >
                            <ActivityIndicator color={colors.foreground} />
                        </View>
                    ) : null}
                </View>
                {permission && !permission.granted ? (
                    <InlineNotice
                        tone="warning"
                        message={t`Camera access is off. Paste the code instead.`}
                    />
                ) : null}
                {relayNeeded ? (
                    <View className="gap-3">
                        <InlineNotice
                            testID={
                                relayRefused
                                    ? "agent-relay-refused"
                                    : "agent-unknown-relay"
                            }
                            tone="warning"
                            message={
                                relayRefused
                                    ? refusedRelayMessage(relayNeeded)
                                    : unknownRelayMessage(
                                          relayNeeded,
                                          savedRelays,
                                      )
                            }
                        />
                        <Label>{t`Access token`}</Label>
                        <Input
                            testID="agent-relay-token"
                            value={relayToken}
                            onChangeText={setRelayToken}
                            secureTextEntry
                            autoCapitalize="none"
                            autoCorrect={false}
                            accessibilityLabel={t`Relay access token`}
                        />
                        <Button
                            disabled={!relayToken.trim()}
                            loading={busy}
                            loadingLabel={t`Checking…`}
                            onPress={() => void saveRelayAndRetry()}
                        >
                            {t`Continue`}
                        </Button>
                    </View>
                ) : (
                    <Button
                        testID="agent-paste"
                        variant="outline"
                        disabled={busy}
                        onPress={() => {
                            setPasteError("");
                            setPasteOpen(true);
                        }}
                    >
                        {t`Paste code`}
                    </Button>
                )}
                <Text
                    style={{
                        color: colors.muted,
                        fontSize: 12,
                        lineHeight: 18,
                    }}
                >
                    <Trans>
                        On the Linux machine, run{" "}
                        <Text
                            className="font-mono"
                            style={{ color: colors.foreground, fontSize: 12 }}
                        >
                            cryptex-agent pair
                        </Text>
                        .
                    </Trans>
                </Text>
            </View>
            <Dialog
                open={pasteOpen && isFocused}
                onOpenChange={(open) => !open && setPasteOpen(false)}
                placement="bottom"
                scroll
            >
                <DialogHeader>
                    <DialogTitle>{t`Paste code`}</DialogTitle>
                </DialogHeader>
                <View className="gap-4">
                    <Label>{t`Pairing code`}</Label>
                    <Input
                        testID="agent-paste-input"
                        autoFocus
                        value={pasteDraft}
                        onChangeText={(text) => {
                            setPasteDraft(text);
                            setPasteError("");
                        }}
                        autoCapitalize="none"
                        autoCorrect={false}
                        // i18n-ignore: pairing code prefix
                        placeholder="cryptex-pair:…"
                        multiline
                        numberOfLines={4}
                        textAlignVertical="top"
                        accessibilityLabel={t`Pasted pairing code`}
                        style={{ height: 110, paddingVertical: 12 }}
                    />
                    {pasteError ? (
                        <InlineNotice
                            testID="agent-paste-error"
                            tone="error"
                            message={pasteError}
                        />
                    ) : null}
                    <Button
                        testID="agent-paste-submit"
                        disabled={!pasteDraft.trim()}
                        loading={busy}
                        loadingLabel={t`Checking…`}
                        onPress={() => void submitCode(pasteDraft)}
                    >
                        {t`Continue`}
                    </Button>
                </View>
            </Dialog>
        </UnlockedTaskScreen>
    );
}
