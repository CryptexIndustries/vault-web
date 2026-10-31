import { useMemo, useState } from "react";
import { FlatList, Pressable, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useAtomValue } from "jotai";
import { i18n } from "@lingui/core";
import { useLingui } from "@lingui/react/macro";
import { useLingui as useActiveLocale } from "@lingui/react";
import {
    ChevronDown,
    ChevronRight,
    Clock,
    GitCommitHorizontal,
    KeyRound,
    MoreHorizontal,
    PenLine,
} from "lucide-react-native";
import {
    revokeAgent,
    setAgentPaused,
    updateAgentKeys,
} from "@cryptex-industries/vault-core/agent/agent-actions";
import {
    agentKeyOptions,
    machineLabel,
    relayLabel,
} from "@cryptex-industries/vault-core/agent/agent-format";
import { sanitizeDisplayText } from "@cryptex-industries/vault-core/agent/request-check";
import { sshKeyItems } from "@cryptex-industries/vault-core/agent/vault-agents";
import {
    AgentRequestKind,
    type AgentRequestRecord,
} from "@cryptex-industries/vault-core/proto";

import {
    Dialog,
    DialogDescription,
    DialogHeader,
} from "@/components/ui/dialog";
import { InlineNotice } from "@/components/inline-notice";
import {
    UnlockedButton as Button,
    UnlockedDialogTitle as DialogTitle,
    UnlockedTaskScreen,
    UnlockedText as Text,
} from "@/components/unlocked/unlocked-ui";
import { useUnlockedConfirmation } from "@/components/unlocked/confirmation-sheet";
import { useUnlockedSnackbar } from "@/components/unlocked/unlocked-snackbar";
import {
    AgentGlyph,
    AgentSectionLabel,
    InfoCard,
    KeyPickerList,
    KeyRow,
} from "@/components/agents/agent-rows";
import { AgentNotificationsNotice } from "@/components/agents/agent-notifications-notice";
import { agentRuntime } from "@/agent/agent-app";
import { changeAgent, revokeAgentInVault } from "@/agent/agent-vault";
import { useConnectedAgents } from "@/agent/use-agents";
import { formatAgo, historyTitle, outcomeLabel } from "@/agent/agent-wording";
import { env } from "@/env";
import { sshKeyInfo } from "@/utils/ssh-keys";
import { unlockedVaultAtom } from "@/utils/atoms";
import { colors } from "@/theme";
import { vaultLog } from "@/utils/logging";

const RECENT_COUNT = 5;

function HistoryRow({ entry }: { entry: AgentRequestRecord }) {
    const Icon =
        entry.Kind === AgentRequestKind.AgentRequestSignature
            ? entry.Namespace === "git"
                ? GitCommitHorizontal
                : PenLine
            : KeyRound;
    // FlatList rows only re-render on a language change when they subscribe.
    useActiveLocale();
    return (
        <View
            style={{
                minHeight: 64,
                flexDirection: "row",
                alignItems: "center",
                gap: 12,
                borderBottomWidth: 1,
                borderBottomColor: colors.border,
            }}
        >
            <View
                style={{
                    width: 36,
                    height: 36,
                    borderRadius: 18,
                    alignItems: "center",
                    justifyContent: "center",
                    backgroundColor: colors.secondary,
                }}
            >
                <Icon size={17} color={colors.muted} strokeWidth={1.8} />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
                <Text numberOfLines={1} style={{ fontSize: 14 }}>
                    {historyTitle(entry)}
                </Text>
                <Text
                    numberOfLines={1}
                    style={{ fontSize: 12, color: colors.muted, marginTop: 4 }}
                >
                    {`${outcomeLabel(entry.Outcome)}, ${formatAgo(entry.Timestamp).toLowerCase()}`}
                </Text>
            </View>
        </View>
    );
}

export default function AgentScreen() {
    const { t } = useLingui();
    const { id } = useLocalSearchParams<{ id: string }>();
    const vault = useAtomValue(unlockedVaultAtom);
    const { agents, approvedHere } = useConnectedAgents();
    const confirm = useUnlockedConfirmation();
    const showSnackbar = useUnlockedSnackbar();
    const [menuOpen, setMenuOpen] = useState(false);
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState<string[]>([]);
    const [saving, setSaving] = useState(false);
    const [showAll, setShowAll] = useState(false);
    const [keysOpen, setKeysOpen] = useState(false);
    const [pausing, setPausing] = useState(false);
    const agent = agents.find((item) => item.ID === id);
    const keys = useMemo(
        () => agentKeyOptions(sshKeyItems(vault), sshKeyInfo, t`SSH key`),
        [vault, t],
    );

    if (!agent) {
        return (
            <UnlockedTaskScreen title={t`Agent`}>
                <Text style={{ color: colors.muted }}>
                    {t`This agent was revoked or isn't in this vault anymore.`}
                </Text>
            </UnlockedTaskScreen>
        );
    }

    const here = approvedHere(agent);
    const name = sanitizeDisplayText(agent.Name || t`Agent`);

    const saveKeys = async () => {
        setSaving(true);
        try {
            await updateAgentKeys(
                agent,
                sshKeyItems(vault).filter((item) => draft.includes(item.ID)),
                {
                    sendKeys: (agentId, input) =>
                        agentRuntime.sendKeys(agentId, input),
                    changeAgent,
                },
            );
            setEditing(false);
            showSnackbar(t`Keys updated`);
        } catch {
            showSnackbar(
                t`Couldn't update the keys. Check your connection and try again.`,
            );
        } finally {
            setSaving(false);
        }
    };

    const revoke = async () => {
        try {
            const { relayRevoked } = await revokeAgent(agent, {
                approvedHere: here,
                unregister: (agentId) => agentRuntime.unregister(agentId),
                hostedRelayUrl: env.RELAY_URL,
                fetch: (...args) => fetch(...args),
                markRevoked: revokeAgentInVault,
                log: (message, detail) =>
                    vaultLog.info(`Agent: ${message}`, { detail }),
            });
            showSnackbar(
                relayRevoked
                    ? t`Agent revoked`
                    : t`Agent revoked. The relay will be told when the approving device syncs.`,
            );
            router.back();
        } catch {
            showSnackbar(t`Couldn't revoke the agent. Try again.`);
        }
    };

    const confirmRevoke = () =>
        confirm({
            title: t`Revoke ${name}?`,
            description: t`The agent can't ask for signatures anymore. To use it again, pair it again with cryptex-agent pair.`,
            confirmLabel: t`Revoke agent`,
            cancelLabel: t`Cancel`,
            destructive: true,
            onConfirm: () => void revoke(),
        });

    const paused = agent.Paused;
    const relayForgot = here && agentRuntime.relayForgot(agent.ID);

    const togglePaused = async () => {
        setPausing(true);
        try {
            await setAgentPaused(agent.ID, !paused, {
                changeAgent,
                runtime: agentRuntime,
            });
            showSnackbar(paused ? t`Agent resumed` : t`Agent paused`);
        } catch {
            showSnackbar(
                paused
                    ? t`Couldn't resume the agent. Try again.`
                    : t`Couldn't pause the agent. Try again.`,
            );
        } finally {
            setPausing(false);
        }
    };

    if (editing) {
        return (
            <UnlockedTaskScreen
                title={t`Edit keys`}
                onBack={() => setEditing(false)}
                scroll={false}
                footer={
                    <View style={{ gap: 12 }}>
                        {draft.length ? null : (
                            <InlineNotice
                                tone="warning"
                                testID="agent-no-keys"
                                message={t`With no keys, this agent can't sign anything until you add some again.`}
                            />
                        )}
                        <Button
                            testID="agent-keys-save"
                            loading={saving}
                            loadingLabel={t`Saving…`}
                            onPress={() => void saveKeys()}
                        >
                            {t`Save keys`}
                        </Button>
                    </View>
                }
            >
                <KeyPickerList
                    keys={keys}
                    selected={draft}
                    onChange={setDraft}
                    disabled={saving}
                    maxWidth={720}
                    title={t`Keys this agent can use`}
                    header={
                        <>
                            <Text
                                style={{
                                    color: colors.muted,
                                    fontSize: 13,
                                    lineHeight: 20,
                                }}
                            >
                                {t`${name} can ask to sign with the keys you pick. It gets the new list the next time it connects.`}
                            </Text>
                        </>
                    }
                />
            </UnlockedTaskScreen>
        );
    }

    const approverName = sanitizeDisplayText(
        agent.ApproverName || (here ? t`This device` : t`Another device`),
    );
    const keyCount = agent.CredentialIDs.length;
    const machine = machineLabel(agent, t`Unknown machine`);
    const pairedDate = new Date(agent.PairedAtTimestamp).toLocaleDateString(
        i18n.locale,
        { month: "short", day: "numeric", year: "numeric" },
    );
    const history = showAll
        ? agent.History
        : agent.History.slice(0, RECENT_COUNT);
    return (
        <UnlockedTaskScreen
            title={t`Agent`}
            scroll={false}
            actions={
                <View style={{ flexDirection: "row", alignItems: "center" }}>
                    {here ? (
                        <Pressable
                            testID="agent-edit-keys"
                            accessibilityRole="button"
                            accessibilityLabel={t`Edit keys`}
                            onPress={() => {
                                setDraft(agent.CredentialIDs);
                                setEditing(true);
                            }}
                            style={{
                                minHeight: 48,
                                paddingHorizontal: 12,
                                justifyContent: "center",
                            }}
                        >
                            <Text
                                style={{
                                    color: colors.primary,
                                    fontSize: 14,
                                    fontWeight: "600",
                                }}
                            >
                                {t`Edit keys`}
                            </Text>
                        </Pressable>
                    ) : null}
                    <Pressable
                        testID="agent-menu"
                        accessibilityRole="button"
                        accessibilityLabel={t`More agent actions`}
                        onPress={() => setMenuOpen(true)}
                        style={{
                            width: 48,
                            height: 48,
                            alignItems: "center",
                            justifyContent: "center",
                        }}
                    >
                        <MoreHorizontal size={22} color={colors.foreground} />
                    </Pressable>
                </View>
            }
        >
            {/* One scroller: the page scrolls with the request list, and only
                the rows on screen are drawn. */}
            <FlatList
                style={{ flex: 1 }}
                contentContainerStyle={{
                    width: "100%",
                    maxWidth: 720,
                    alignSelf: "center",
                    paddingHorizontal: 20,
                    paddingTop: 24,
                    paddingBottom: 30,
                }}
                data={history}
                keyExtractor={(entry, index) => `${entry.Timestamp}-${index}`}
                renderItem={({ item }) => <HistoryRow entry={item} />}
                initialNumToRender={12}
                windowSize={7}
                showsVerticalScrollIndicator={false}
                ListHeaderComponent={
                    <View>
                        <View className="mb-4 flex-row items-center gap-3.5">
                            <AgentGlyph variant="identity" />
                            <View className="min-w-0 flex-1">
                                <Text
                                    className="font-medium text-2xl tracking-[-0.7px] text-foreground"
                                    accessibilityRole="header"
                                >
                                    {name}
                                </Text>
                                <Text className="mt-1 text-xs text-muted-foreground">
                                    {agent.AgentVersion
                                        ? `${machine}, cryptex-agent ${sanitizeDisplayText(agent.AgentVersion, 32)}`
                                        : machine}
                                </Text>
                                <View className="mt-1.5 flex-row items-center gap-1.5">
                                    <Clock size={13} color={colors.muted} />
                                    <Text
                                        testID="agent-paired"
                                        className="text-xs text-muted-foreground"
                                    >
                                        {t`Paired ${pairedDate}`}
                                    </Text>
                                </View>
                            </View>
                        </View>
                        {relayForgot ? (
                            <InlineNotice
                                testID="agent-relay-forgot"
                                tone="warning"
                                className="mb-3"
                                message={t`The relay no longer knows this agent. Pair it again or remove it.`}
                                action={{
                                    label: t`Remove agent`,
                                    testID: "agent-relay-forgot-remove",
                                    onPress: confirmRevoke,
                                }}
                            />
                        ) : null}
                        {paused ? (
                            <InlineNotice
                                testID="agent-paused"
                                tone="info"
                                className="mb-3"
                                message={t`Paused. Requests from this agent are refused without asking.`}
                                action={{
                                    label: pausing ? t`Resuming…` : t`Resume`,
                                    testID: "agent-resume",
                                    onPress: () => {
                                        if (!pausing) void togglePaused();
                                    },
                                }}
                            />
                        ) : null}
                        {here ? (
                            <AgentNotificationsNotice
                                style={{ marginBottom: 12 }}
                            />
                        ) : null}
                        <InfoCard
                            label={t({
                                message: "Approver",
                                comment:
                                    "The device that approves this agent's sign requests",
                            })}
                            value={
                                here
                                    ? t`${approverName} (this device)`
                                    : approverName
                            }
                        />
                        <InfoCard
                            label={t`Relay`}
                            value={relayLabel(
                                agent.RelayOrigin,
                                t`Online Services`,
                            )}
                        />
                        <Pressable
                            testID="agent-keys-toggle"
                            accessibilityRole="button"
                            accessibilityLabel={t`Keys, ${keyCount}`}
                            accessibilityState={{ expanded: keysOpen }}
                            onPress={() => setKeysOpen((open) => !open)}
                            hitSlop={8}
                        >
                            <AgentSectionLabel
                                title={t`Keys`}
                                right={
                                    <View
                                        style={{
                                            flexDirection: "row",
                                            alignItems: "center",
                                            gap: 8,
                                        }}
                                    >
                                        <Text
                                            style={{
                                                fontSize: 11,
                                                color: colors.muted,
                                            }}
                                        >
                                            {String(agent.CredentialIDs.length)}
                                        </Text>
                                        {keysOpen ? (
                                            <ChevronDown
                                                size={16}
                                                color={colors.muted}
                                            />
                                        ) : (
                                            <ChevronRight
                                                size={16}
                                                color={colors.muted}
                                            />
                                        )}
                                    </View>
                                }
                            />
                        </Pressable>
                        {!keysOpen ? null : agent.CredentialIDs.length ? (
                            agent.CredentialIDs.map((credentialId) => {
                                const key = keys.find(
                                    (item) => item.id === credentialId,
                                );
                                return (
                                    <KeyRow
                                        key={credentialId}
                                        name={key?.name ?? t`Deleted item`}
                                        detail={
                                            key?.detail ??
                                            t`No longer in the vault`
                                        }
                                    />
                                );
                            })
                        ) : (
                            <Text
                                style={{
                                    color: colors.muted,
                                    fontSize: 13,
                                    paddingVertical: 14,
                                }}
                            >
                                {t`No keys.`}
                            </Text>
                        )}
                        <AgentSectionLabel
                            title={t`Recent requests`}
                            right={
                                agent.History.length > RECENT_COUNT ? (
                                    <Pressable
                                        accessibilityRole="button"
                                        onPress={() =>
                                            setShowAll((value) => !value)
                                        }
                                        hitSlop={8}
                                    >
                                        <Text
                                            style={{
                                                fontSize: 12,
                                                color: colors.primary,
                                                fontWeight: "600",
                                            }}
                                        >
                                            {showAll
                                                ? t`Show less`
                                                : t`See all`}
                                        </Text>
                                    </Pressable>
                                ) : undefined
                            }
                        />
                    </View>
                }
                ListEmptyComponent={
                    <Text
                        style={{
                            color: colors.muted,
                            fontSize: 13,
                            paddingVertical: 14,
                        }}
                    >
                        {t`No requests yet.`}
                    </Text>
                }
            />

            <Dialog
                open={menuOpen}
                onOpenChange={setMenuOpen}
                placement="bottom"
            >
                <DialogHeader>
                    <DialogTitle>{name}</DialogTitle>
                    <DialogDescription>
                        {t`Choose an action for this agent.`}
                    </DialogDescription>
                </DialogHeader>
                <Button
                    testID={paused ? "agent-menu-resume" : "agent-pause"}
                    variant="secondary"
                    disabled={pausing}
                    onPress={() => {
                        setMenuOpen(false);
                        void togglePaused();
                    }}
                >
                    {paused ? t`Resume agent` : t`Pause agent`}
                </Button>
                <Button
                    testID="agent-revoke"
                    variant="destructive"
                    onPress={() => {
                        setMenuOpen(false);
                        confirmRevoke();
                    }}
                >
                    {t`Revoke agent`}
                </Button>
            </Dialog>
        </UnlockedTaskScreen>
    );
}
