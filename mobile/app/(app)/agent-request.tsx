import { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useAtomValue } from "jotai";
import { useLingui } from "@lingui/react/macro";
import { ShieldCheck } from "lucide-react-native";
import { setAgentPaused } from "@cryptex-industries/vault-core/agent/agent-actions";
import {
    checkKnownHost,
    forwardedViaLabel,
    isDestinationUnknown,
    requestHasHiddenCharacters,
    serverName,
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
import {
    ApprovalInProgressError,
    RequestGoneError,
    VaultLockedError,
} from "@cryptex-industries/vault-core/agent/runtime";
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
import {
    AgentSectionLabel,
    InfoCard,
    RadioRow,
} from "@/components/agents/agent-rows";
import { agentRuntime } from "@/agent/agent-app";
import {
    knownHostWarnings,
    rememberLabel,
    requestTitle,
    serverNameNote,
} from "@/agent/agent-wording";
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

/**
 * The prompt's details, not selectable: this screen drops touches while
 * another window covers it (tapjacking protection), and Android's text
 * selection handles and Copy toolbar are such windows, so a selection
 * would block every tap until it is copied.
 */
function PromptCard(props: Omit<Parameters<typeof InfoCard>[0], "selectable">) {
    return <InfoCard {...props} selectable={false} />;
}

function VerifiedBadge() {
    const { t } = useLingui();
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
            <Text style={{ fontSize: 11, color: colors.success }}>
                {t({
                    message: "verified",
                    comment:
                        "Badge next to the SSH server's host key fingerprint: the server proved it holds this key",
                })}
            </Text>
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
    const { t } = useLingui();
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

    const key = useMemo(
        () => (request ? agentRuntime.keyFor(request) : null),
        [request],
    );

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
                    ? t`This request is no longer waiting.`
                    : error instanceof VaultLockedError
                      ? t`Unlock your vault to approve this request.`
                      : error instanceof ApprovalInProgressError
                        ? t`This request is being approved already.`
                        : error instanceof Error
                          ? error.message
                          : t`Couldn't sign this request.`,
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
            showSnackbar(t`Agent paused`);
        } catch {
            showSnackbar(t`Couldn't pause the agent. Try again.`);
        } finally {
            setBusy(null);
            finish();
        }
    };

    if (!request) {
        return (
            <UnlockedTaskScreen
                title={t`SSH request`}
                onBack={leave}
                footer={
                    waited ? (
                        <Button variant="outline" onPress={leave}>
                            {t`Close`}
                        </Button>
                    ) : undefined
                }
            >
                {waited ? (
                    <Text
                        style={{
                            color: colors.muted,
                            fontSize: 14,
                            lineHeight: 21,
                        }}
                    >
                        {t`This request is no longer waiting. It was answered, withdrawn or it expired.`}
                    </Text>
                ) : (
                    <View
                        style={{
                            flexDirection: "row",
                            gap: 10,
                            alignItems: "center",
                        }}
                    >
                        <ActivityIndicator color={colors.muted} size="small" />
                        <Text style={{ color: colors.muted, fontSize: 13 }}>
                            {t`Waiting for the request…`}
                        </Text>
                    </View>
                )}
            </UnlockedTaskScreen>
        );
    }

    const { check } = request;
    const agentName = sanitizeDisplayText(
        agentRuntime.agentName(request.agentId),
    );
    const caller = callerProcess(request.sign.processes);
    const keyName = key
        ? sanitizeDisplayText(key.name || t`SSH key`, 40)
        : t({
              message: "Unknown",
              comment:
                  "Name of the requested SSH key when it isn't one this agent may use",
          });
    const keyLabel = key
        ? `${keyName}, ${sshKeyInfo({ Type: ItemType.SSHKey, SSHKey: key.sshKey })?.label ?? t`SSH key`}`
        : t`Not granted to this agent`;
    const choices = rememberChoices(request);
    const unknown = isDestinationUnknown(request);
    const signature = check.kind === "signature";
    const forwarded = check.forwardedVia.length > 0;
    const via = forwardedViaLabel(request);
    const waitingCount = agentRuntime.waitingCount();
    const position =
        agentRuntime
            .pendingRequests()
            .findIndex((item) => item.id === request.id) + 1;
    // Server names come from the machine's known_hosts; only a name the user
    // approved for this host key before counts as known.
    const hostCheck = checkKnownHost(
        liveAgent(vault, request.agentId),
        request,
    );
    const hostWarnings = knownHostWarnings(hostCheck);
    const hidden = requestHasHiddenCharacters(request);

    const approveButton = (
        <Button
            testID="agent-approve"
            className="flex-1"
            variant={unknown ? "outline" : "default"}
            disabled={!key || !armed || busy !== null}
            loading={busy === "approve"}
            loadingLabel={t`Signing…`}
            onPress={() => void approve()}
        >
            {unknown ? t`Approve once` : t`Approve`}
        </Button>
    );
    const denyButton = (
        <Button
            testID="agent-deny"
            className="flex-1"
            variant={unknown ? "default" : "outline"}
            disabled={busy !== null}
            loading={busy === "deny"}
            loadingLabel={t`Denying…`}
            onPress={() => void deny()}
        >
            {t`Deny`}
        </Button>
    );

    return (
        <UnlockedTaskScreen
            title={t`SSH request`}
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
                        style={{
                            color: colors.muted,
                            fontSize: 12,
                            marginBottom: 6,
                        }}
                    >
                        {t({
                            message: `${position} of ${waitingCount}`,
                            comment:
                                "Which of the waiting SSH requests this is, for example 2 of 3",
                        })}
                    </Text>
                ) : null}
                <Text
                    accessibilityRole="header"
                    style={{
                        fontSize: 22,
                        fontWeight: "500",
                        letterSpacing: -0.5,
                        marginBottom: 14,
                    }}
                >
                    {requestTitle(request)}
                </Text>
                {hostWarnings.map((warning) => (
                    <InlineNotice
                        key={warning}
                        className="mb-3"
                        testID="agent-host-warning"
                        tone="error"
                        message={t({
                            message: `${warning} Approve only if you expected this change.`,
                            comment:
                                "{warning} is a full sentence saying the server's host key or name changed since it was last approved",
                        })}
                    />
                ))}
                {hidden ? (
                    <InlineNotice
                        className="mb-3"
                        testID="agent-hidden-characters"
                        tone="warning"
                        message={t({
                            message:
                                "Contains hidden characters. Text from the machine had invisible characters, shown here as \uFFFD.",
                            comment:
                                "The last character is the Unicode replacement character, which stands in for each invisible character",
                        })}
                    />
                ) : null}
                {unknown ? (
                    <InlineNotice
                        className="mb-3"
                        tone="warning"
                        message={t`This client didn't say which server it is logging in to. Approve only if you just started this login yourself.`}
                    />
                ) : null}
                {forwarded ? (
                    <InlineNotice
                        className="mb-3"
                        tone="warning"
                        message={t({
                            message: `This request came through agent forwarding on ${via}. A server you're logged in to is asking to use your key.`,
                            comment:
                                "SSH agent forwarding; {via} is the machine the request was forwarded through",
                        })}
                    />
                ) : null}
                <PromptCard label={t`Agent`} value={agentName} />
                {forwarded ? (
                    <PromptCard
                        label={t({
                            message: "Via",
                            comment:
                                "The machine an SSH agent-forwarded request came through",
                        })}
                        value={via}
                    />
                ) : null}
                {check.kind === "login" && check.verifiedHost ? (
                    <>
                        <PromptCard
                            label={t({
                                message: "Server",
                                comment: "The SSH server the login is for",
                            })}
                            value={
                                hostCheck?.name ??
                                serverName(check.verifiedHost)
                            }
                            monospace={hidden}
                            note={
                                hostCheck?.name
                                    ? serverNameNote(hostCheck)
                                    : undefined
                            }
                        />
                        <PromptCard
                            label={t({
                                message: "Host key",
                                comment:
                                    "SSH host key of the server; the value is its fingerprint",
                            })}
                            value={shortFingerprint(
                                check.verifiedHost.fingerprint,
                            )}
                            badge={<VerifiedBadge />}
                            note={t({
                                message: "The server proved it holds this key",
                                comment:
                                    "Note under the SSH host key fingerprint",
                            })}
                            monospace
                        />
                    </>
                ) : null}
                {check.user ? (
                    <PromptCard
                        label={t({
                            message: "User",
                            comment: "The user name the SSH login is for",
                        })}
                        value={sanitizeDisplayText(check.user)}
                        monospace={hidden}
                    />
                ) : null}
                <PromptCard
                    label={t({
                        message: "Key",
                        comment: "The SSH key the request wants to sign with",
                    })}
                    value={keyLabel}
                />
                {signature ? (
                    <PromptCard
                        label={t({
                            message: "Namespace",
                            comment:
                                "SSH signature namespace (ssh-keygen -n), for example git or file",
                        })}
                        value={sanitizeDisplayText(
                            check.namespace ||
                                t({
                                    message: "none",
                                    comment:
                                        "Shown as the SSH signature namespace when the request names none",
                                }),
                            32,
                        )}
                        monospace
                    />
                ) : null}
                <PromptCard
                    label={t({
                        message: "Process",
                        comment:
                            "The program on the machine that made the request",
                    })}
                    value={`${processLabel(caller, t`Unknown program`)}${caller ? ` (pid ${caller.pid})` : ""}`}
                    monospace={hidden}
                />
                {signature && caller?.cwd ? (
                    <PromptCard
                        label={t({
                            message: "Folder",
                            comment:
                                "Working folder of the program that asked for the signature",
                        })}
                        value={sanitizeDisplayText(caller.cwd, 120)}
                        monospace={hidden}
                    />
                ) : null}
                <Text
                    style={{
                        color: colors.muted,
                        fontSize: 12,
                        lineHeight: 18,
                        marginBottom: 6,
                    }}
                >
                    {signature
                        ? isGitSignature(request)
                            ? t`The phone sees only a hash of the commit. Process and folder are reported by the machine, and the repository isn't verified.`
                            : t`Process and folder are reported by the machine.`
                        : unknown
                          ? t`Requests like this are never remembered. Process details are reported by the machine.`
                          : t`Process details are reported by the machine.`}
                </Text>
                {choices.length && key ? (
                    <>
                        <AgentSectionLabel
                            title={t({
                                message: "Remember",
                                comment:
                                    "Section heading: choices for remembering this approval",
                            })}
                        />
                        {choices.map((item) => (
                            <RadioRow
                                key={item}
                                testID={`agent-remember-${item}`}
                                label={rememberLabel(
                                    item,
                                    request,
                                    keyName,
                                    agentName,
                                )}
                                selected={choice === item}
                                onPress={() => setChoice(item)}
                            />
                        ))}
                    </>
                ) : null}
                <Button
                    testID="agent-pause-from-request"
                    variant="secondary"
                    className="mt-4"
                    disabled={busy !== null}
                    loading={busy === "pause"}
                    loadingLabel={t`Pausing…`}
                    onPress={() => void pause()}
                >
                    {t`Pause ${agentName}`}
                </Button>
                <Text
                    style={{
                        color: colors.muted,
                        fontSize: 12,
                        lineHeight: 18,
                        textAlign: "center",
                    }}
                >
                    {t`Refuses its requests without asking until you resume it.`}
                </Text>
            </View>
        </UnlockedTaskScreen>
    );
}
