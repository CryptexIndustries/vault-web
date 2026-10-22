import { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useAtomValue } from "jotai";
import { ShieldCheck } from "lucide-react-native";
import { setAgentPaused } from "@cryptex-industries/vault-core/agent/agent-actions";
import {
    checkKnownHost,
    forwardedViaLabel,
    isDestinationUnknown,
    rememberLabel,
    knownHostWarnings,
    requestHasHiddenCharacters,
    requestTitle,
    serverName,
    serverNameNote,
    shortFingerprint,
} from "@cryptex-industries/vault-core/agent/agent-format";
import {
    callerProcess,
    isGitSignature,
    processLabel,
    rememberChoices,
    type RememberChoice,
} from "@cryptex-industries/vault-core/agent/remember";
import { sanitizeDisplayText } from "@cryptex-industries/vault-core/agent/request-check";
import { RequestGoneError } from "@cryptex-industries/vault-core/agent/runtime";
import { liveAgent } from "@cryptex-industries/vault-core/agent/vault-agents";
import { ItemType } from "@cryptex-industries/vault-core/proto";

import { InlineNotice } from "@/components/inline-notice";
import {
    UnlockedButton as Button,
    UnlockedTaskScreen,
    UnlockedText as Text,
} from "@/components/unlocked/unlocked-ui";
import {
    useClearUnlockedSnackbar,
    useUnlockedSnackbar,
} from "@/components/unlocked/unlocked-snackbar";
import { AgentSectionLabel, InfoCard, RadioRow } from "@/components/agents/agent-rows";
import { agentRuntime } from "@/agent/agent-app";
import { useAgentRuntimeVersion } from "@/agent/agent-runtime-bridge";
import { agentService } from "@/agent/agent-service";
import { changeAgent } from "@/agent/agent-vault";
import { APPROVE_DELAY_MS, isApprovalToken } from "@/agent/approval-screen";
import { sshKeyInfo } from "@/utils/ssh-keys";
import { unlockedVaultAtom } from "@/utils/atoms";
import { colors } from "@/theme";

/** Leaves the screen; it can be the only one after unlock replaced the stack. */
function leave() {
    if (router.canGoBack()) router.back();
    else router.replace("/(app)/(tabs)/vault");
}

/** How long to wait for a request that hasn't arrived yet (after a cold start). */
const ARRIVAL_WAIT_MS = 15_000;

function VerifiedBadge() {
    return (
        <View
            style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 3,
                paddingHorizontal: 7,
                paddingVertical: 2,
                borderRadius: 99,
                backgroundColor: "rgba(37,196,114,0.15)",
            }}
        >
            <ShieldCheck size={11} color={colors.success} />
            <Text style={{ fontSize: 11, color: colors.success }}>verified</Text>
        </View>
    );
}

export default function AgentRequestScreen() {
    const params = useLocalSearchParams<{ id: string; token?: string }>();
    const token = Array.isArray(params.token) ? params.token[0] : params.token;
    // Only the app opens this screen; a link from elsewhere goes to the vault.
    const genuine = isApprovalToken(token);
    useEffect(() => {
        if (!genuine) router.replace("/(app)/(tabs)/vault");
    }, [genuine]);
    return genuine ? <AgentRequestView /> : null;
}

function AgentRequestView() {
    const params = useLocalSearchParams<{ id: string }>();
    const id = Array.isArray(params.id) ? params.id[0] : params.id;
    useAgentRuntimeVersion();
    const vault = useAtomValue(unlockedVaultAtom);
    const showSnackbar = useUnlockedSnackbar();
    const request = id ? agentRuntime.getRequest(id) : undefined;
    const [choice, setChoice] = useState<RememberChoice>("once");
    const [busy, setBusy] = useState<"approve" | "deny" | "pause" | null>(null);
    const [waited, setWaited] = useState(false);
    const [armedId, setArmedId] = useState<string | null>(null);

    useEffect(() => {
        agentRuntime.setShownRequest(id ?? null, true);
        setChoice("once");
        return () => agentRuntime.setShownRequest(null, false);
    }, [id]);

    useEffect(() => {
        agentService.setApprovalScreenProtected(true);
        return () => agentService.setApprovalScreenProtected(false);
    }, []);

    // A notice from the screen underneath, like "Connected", would cover the
    // Remember choices.
    const clearSnackbar = useClearUnlockedSnackbar();
    useEffect(clearSnackbar, [clearSnackbar]);

    // Approve turns on a moment after each request appears.
    const requestId = request?.id ?? null;
    useEffect(() => {
        setArmedId(null);
        if (!requestId) return;
        const timer = setTimeout(() => setArmedId(requestId), APPROVE_DELAY_MS);
        return () => clearTimeout(timer);
    }, [requestId]);
    const armed = requestId !== null && armedId === requestId;

    useEffect(() => {
        const timer = setTimeout(() => setWaited(true), ARRIVAL_WAIT_MS);
        return () => clearTimeout(timer);
    }, []);

    // Answered elsewhere or expired: move on to the next one, or close once
    // the request was on screen (a cold start waits for it to arrive).
    const seen = useRef<string | null>(null);
    const leaving = useRef(false);
    useEffect(() => {
        if (request) {
            seen.current = request.id;
            return;
        }
        if (busy || leaving.current) return;
        const next = agentRuntime.nextRequest();
        if (next) router.setParams({ id: next.id });
        else if (seen.current === id) leave();
    }, [request, busy, id]);

    const key = useMemo(() => (request ? agentRuntime.keyFor(request) : null), [request]);

    const finish = () => {
        const next = agentRuntime.nextRequest();
        if (next) router.setParams({ id: next.id });
        else {
            leaving.current = true;
            leave();
        }
    };

    const approve = async () => {
        if (!request || !armed) return;
        setBusy("approve");
        try {
            await agentRuntime.approve(request.id, choice);
            finish();
        } catch (error) {
            showSnackbar(
                error instanceof RequestGoneError
                    ? "This request is no longer waiting."
                    : error instanceof Error
                      ? error.message
                      : "Couldn't sign this request.",
            );
            if (error instanceof RequestGoneError) finish();
        } finally {
            setBusy(null);
        }
    };

    const deny = async () => {
        if (!request) return;
        setBusy("deny");
        try {
            await agentRuntime.deny(request.id);
        } finally {
            setBusy(null);
            finish();
        }
    };

    // Refuses this and every later request of the agent without asking,
    // until someone resumes it (synced, so on any device).
    const pause = async () => {
        if (!request) return;
        setBusy("pause");
        try {
            await setAgentPaused(request.agentId, true, {
                changeAgent,
                runtime: agentRuntime,
            });
            showSnackbar("Agent paused");
        } catch {
            showSnackbar("Couldn't pause the agent. Try again.");
        } finally {
            setBusy(null);
            finish();
        }
    };

    if (!request) {
        return (
            <UnlockedTaskScreen
                title="SSH request"
                onBack={leave}
                footer={
                    waited ? (
                        <Button variant="outline" onPress={leave}>
                            Close
                        </Button>
                    ) : undefined
                }
            >
                {waited ? (
                    <Text style={{ color: colors.muted, fontSize: 14, lineHeight: 21 }}>
                        This request is no longer waiting. It was answered, withdrawn or
                        it expired.
                    </Text>
                ) : (
                    <View style={{ flexDirection: "row", gap: 10, alignItems: "center" }}>
                        <ActivityIndicator color={colors.muted} size="small" />
                        <Text style={{ color: colors.muted, fontSize: 13 }}>
                            Waiting for the request…
                        </Text>
                    </View>
                )}
            </UnlockedTaskScreen>
        );
    }

    const { check } = request;
    const agentName = sanitizeDisplayText(agentRuntime.agentName(request.agentId));
    const caller = callerProcess(request.sign.processes);
    const keyName = key ? sanitizeDisplayText(key.name || "SSH key", 40) : "Unknown";
    const keyLabel = key
        ? `${keyName}, ${sshKeyInfo({ Type: ItemType.SSHKey, SSHKey: key.sshKey })?.label ?? "SSH key"}`
        : "Not granted to this agent";
    const choices = rememberChoices(request);
    const unknown = isDestinationUnknown(request);
    const signature = check.kind === "signature";
    const forwarded = check.forwardedVia.length > 0;
    const via = forwardedViaLabel(request);
    const waitingCount = agentRuntime.waitingCount();
    const position =
        agentRuntime.pendingRequests().findIndex((item) => item.id === request.id) + 1;
    // Server names come from the machine's known_hosts; only a name the user
    // approved for this host key before counts as known.
    const hostCheck = checkKnownHost(liveAgent(vault, request.agentId), request);
    const hostWarnings = knownHostWarnings(hostCheck);
    const hidden = requestHasHiddenCharacters(request);

    const approveButton = (
        <Button
            testID="agent-approve"
            className="flex-1"
            variant={unknown ? "outline" : "default"}
            disabled={!key || !armed || busy !== null}
            loading={busy === "approve"}
            loadingLabel="Signing…"
            onPress={() => void approve()}
        >
            {unknown ? "Approve once" : "Approve"}
        </Button>
    );
    const denyButton = (
        <Button
            testID="agent-deny"
            className="flex-1"
            variant={unknown ? "default" : "outline"}
            disabled={busy !== null}
            loading={busy === "deny"}
            loadingLabel="Denying…"
            onPress={() => void deny()}
        >
            Deny
        </Button>
    );

    return (
        <UnlockedTaskScreen
            title="SSH request"
            onBack={leave}
            footer={
                <View style={{ flexDirection: "row", gap: 10 }}>
                    {unknown ? approveButton : denyButton}
                    {unknown ? denyButton : approveButton}
                </View>
            }
        >
            <View className="w-full max-w-[720px] self-center">
                {waitingCount > 1 && position > 0 ? (
                    <Text
                        testID="agent-request-position"
                        style={{ color: colors.muted, fontSize: 12, marginBottom: 6 }}
                    >
                        {`${position} of ${waitingCount}`}
                    </Text>
                ) : null}
                <Text
                    accessibilityRole="header"
                    style={{ fontSize: 22, fontWeight: "500", letterSpacing: -0.5, marginBottom: 14 }}
                >
                    {requestTitle(request)}
                </Text>
                {hostWarnings.map((warning) => (
                    <InlineNotice
                        key={warning}
                        className="mb-3"
                        testID="agent-host-warning"
                        tone="error"
                        message={`${warning} Approve only if you expected this change.`}
                    />
                ))}
                {hidden ? (
                    <InlineNotice
                        className="mb-3"
                        testID="agent-hidden-characters"
                        tone="warning"
                        message={"Contains hidden characters. Text from the machine had invisible characters, shown here as \uFFFD."}
                    />
                ) : null}
                {unknown ? (
                    <InlineNotice
                        className="mb-3"
                        tone="warning"
                        message="This client didn't say which server it is logging in to. Approve only if you just started this login yourself."
                    />
                ) : null}
                {forwarded ? (
                    <InlineNotice
                        className="mb-3"
                        tone="warning"
                        message={`This request came through agent forwarding on ${via}. A server you're logged in to is asking to use your key.`}
                    />
                ) : null}
                <InfoCard label="Agent" value={agentName} />
                {forwarded ? <InfoCard label="Via" value={via} /> : null}
                {check.kind === "login" && check.verifiedHost ? (
                    <>
                        <InfoCard
                            label="Server"
                            value={hostCheck?.name ?? serverName(check.verifiedHost)}
                            monospace={hidden}
                            note={hostCheck?.name ? serverNameNote(hostCheck) : undefined}
                        />
                        <InfoCard
                            label="Host key"
                            value={shortFingerprint(check.verifiedHost.fingerprint)}
                            badge={<VerifiedBadge />}
                            note="The server proved it holds this key"
                            monospace
                        />
                    </>
                ) : null}
                {check.user ? (
                    <InfoCard
                        label="User"
                        value={sanitizeDisplayText(check.user)}
                        monospace={hidden}
                    />
                ) : null}
                <InfoCard label="Key" value={keyLabel} />
                {signature ? (
                    <InfoCard
                        label="Namespace"
                        value={sanitizeDisplayText(check.namespace || "none", 32)}
                        monospace
                    />
                ) : null}
                <InfoCard
                    label="Process"
                    value={`${processLabel(caller)}${caller ? ` (pid ${caller.pid})` : ""}`}
                    monospace={hidden}
                />
                {signature && caller?.cwd ? (
                    <InfoCard
                        label="Folder"
                        value={sanitizeDisplayText(caller.cwd, 120)}
                        monospace={hidden}
                    />
                ) : null}
                <Text style={{ color: colors.muted, fontSize: 12, lineHeight: 18, marginBottom: 6 }}>
                    {signature
                        ? isGitSignature(request)
                            ? "The phone sees only a hash of the commit. Process and folder are reported by the machine, and the repository isn't verified."
                            : "Process and folder are reported by the machine."
                        : unknown
                          ? "Requests like this are never remembered. Process details are reported by the machine."
                          : "Process details are reported by the machine."}
                </Text>
                {choices.length && key ? (
                    <>
                        <AgentSectionLabel title="Remember" />
                        {choices.map((item) => (
                            <RadioRow
                                key={item}
                                testID={`agent-remember-${item}`}
                                label={rememberLabel(item, request, keyName, agentName)}
                                selected={choice === item}
                                onPress={() => setChoice(item)}
                            />
                        ))}
                    </>
                ) : null}
                <Button
                    testID="agent-pause-from-request"
                    variant="ghost"
                    className="mt-4"
                    disabled={busy !== null}
                    loading={busy === "pause"}
                    loadingLabel="Pausing…"
                    onPress={() => void pause()}
                >
                    {`Pause ${agentName}`}
                </Button>
                <Text style={{ color: colors.muted, fontSize: 12, lineHeight: 18, textAlign: "center" }}>
                    Refuses its requests without asking until you resume it.
                </Text>
            </View>
        </UnlockedTaskScreen>
    );
}
