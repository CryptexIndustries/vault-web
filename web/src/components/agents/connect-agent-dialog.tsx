import {
    useEffect,
    useMemo,
    useRef,
    useState,
    type MutableRefObject,
} from "react";
import { useAtomValue } from "jotai";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import type { ClaimedPairing } from "@cryptex-industries/vault-core/agent/approver-types";
import {
    PairingExpiredError,
    UnknownRelayError,
    unknownRelayText,
} from "@cryptex-industries/vault-core/agent/approver";
import { InvalidPairingCodeError } from "@cryptex-industries/vault-core/agent/pairing";
import {
    offerMachineLabel,
    relayLabel,
} from "@cryptex-industries/vault-core/agent/agent-format";
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
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";
import { Textarea } from "@/components/ui/textarea";
import { unlockedVaultAtom } from "@/utils/atoms";
import { useAgentHost } from "./agent-host-context";
import {
    AgentInfoField,
    AgentSectionLabel,
    AgentWarning,
    KeyPicker,
    vaultKeyOptions,
} from "./agent-ui";

type Stage = "paste" | "relay" | "offer" | "code";

const EXPIRED =
    "The pairing code expired or was already used. Press Enter in the terminal for a new code, or run cryptex-agent pair again.";

function claimError(error: unknown): string {
    if (error instanceof InvalidPairingCodeError)
        return "That isn't a cryptex-agent pairing code. Copy the whole line that starts with cryptex-pair:.";
    if (
        error instanceof PairingExpiredError ||
        error instanceof RelayStatusError
    )
        return EXPIRED;
    return "Couldn't reach the relay. Check your connection and try again.";
}

export function ConnectAgentDialog({
    open,
    onOpenChange,
    onConnected,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onConnected: (agentId: string) => void;
}) {
    // While the confirmed agent is being saved the dialog stays open: a
    // cancel then would unregister an agent the vault is about to keep.
    const saving = useRef(false);
    return (
        <Dialog
            open={open}
            onOpenChange={(next) => {
                if (!next && saving.current) return;
                onOpenChange(next);
            }}
        >
            {open ? (
                <ConnectAgentContent
                    onClose={() => onOpenChange(false)}
                    onConnected={onConnected}
                    savingRef={saving}
                />
            ) : null}
        </Dialog>
    );
}

function ConnectAgentContent({
    onClose,
    onConnected,
    savingRef,
}: {
    onClose: () => void;
    onConnected: (agentId: string) => void;
    savingRef: MutableRefObject<boolean>;
}) {
    const host = useAgentHost();
    const vault = useAtomValue(unlockedVaultAtom);
    const [stage, setStage] = useState<Stage>("paste");
    const [code, setCode] = useState("");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const [relayNeeded, setRelayNeeded] = useState("");
    const [relayToken, setRelayToken] = useState("");
    const [claim, setClaim] = useState<ClaimedPairing | null>(null);
    const [name, setName] = useState("");
    const [selected, setSelected] = useState<string[]>([]);
    const [confirmation, setConfirmation] = useState("");
    const endPairing = useRef<(() => void) | null>(null);
    const answered = useRef<string | null>(null);
    const finished = useRef(false);
    // The final save started: Cancel is off and the save decides the outcome.
    const [saving, setSaving] = useState(false);
    const gone = useRef(false);
    const keys = useMemo(() => vaultKeyOptions(vault), [vault]);
    // Custom relays this browser already uses, for the unknown-relay warning.
    const otherRelays = (host?.customRelays() ?? [])
        .map((relay) => relay.origin)
        .filter((origin) => origin !== relayNeeded);

    // Keeps the approver up in this tab while the dialog is open.
    useEffect(() => {
        if (!host) return;
        // Strict mode runs this cleanup once on mount: mounted again here.
        gone.current = false;
        let ended = false;
        host.beginPairing().then(
            (end) => {
                if (ended) end();
                else endPairing.current = end;
            },
            () => {
                if (!ended)
                    setError(
                        "Couldn't start the approver. Lock and unlock the vault, then try again.",
                    );
            },
        );
        return () => {
            ended = true;
            gone.current = true;
            // Closed while the agent waited for its confirmation: cancel it
            // there. Not once the save started (only a lock or leaving the
            // page gets here then): the vault may keep the agent. Before
            // ending the pairing hold, so the runtime is still up; it never
            // takes the approver over, the host may be disposed already.
            if (answered.current && !finished.current && !savingRef.current)
                void host
                    .cancelPairing(answered.current)
                    .catch(() => undefined);
            endPairing.current?.();
            endPairing.current = null;
        };
    }, [host, savingRef]);

    const submitCode = async (text: string) => {
        if (!host || busy || !text.trim()) return;
        setBusy(true);
        setError("");
        try {
            const claimed = await host.claim(text);
            setClaim(claimed);
            setName(
                sanitizeDisplayText(
                    claimed.offer.hostname || "agent",
                    NAME_LENGTH,
                ),
            );
            setSelected(keys.length === 1 ? [keys[0]!.id] : []);
            setStage("offer");
        } catch (caught) {
            if (caught instanceof UnknownRelayError) {
                setRelayNeeded(caught.relayUrl);
                setStage("relay");
            } else {
                setError(claimError(caught));
            }
        } finally {
            setBusy(false);
        }
    };

    const saveRelayAndRetry = async () => {
        if (!host) return;
        const origin = normalizeRelayUrlInput(relayNeeded);
        if (!origin) {
            setError("This relay needs an https:// address.");
            return;
        }
        if (!relayToken.trim()) return;
        setBusy(true);
        try {
            await host.saveCustomRelay({ origin, token: relayToken.trim() });
        } catch {
            setBusy(false);
            setError("Couldn't save the relay token in your vault.");
            return;
        }
        setBusy(false);
        setRelayToken("");
        await submitCode(code);
    };

    const connect = async () => {
        if (!host || !claim || busy) return;
        const agentName = sanitizeDisplayText(name.trim(), NAME_LENGTH);
        const chosen = sshKeyItems(vault).filter((item) =>
            selected.includes(item.ID),
        );
        setBusy(true);
        setError("");
        try {
            const result = await host.accept(claim, {
                agentName,
                keys: grantedKeyInputs(chosen),
            });
            answered.current = claim.agentId;
            setConfirmation(result.confirmationCode);
            setStage("code");
            await host.waitForConfirmation(claim.agentId);
            // Closed while waiting: the cleanup unregistered the agent.
            if (gone.current) return;
            savingRef.current = true;
            setSaving(true);
            const identity =
                host.approverIdentity ?? (await host.ensureIdentity());
            const record = await connectedAgentFromPairing({
                claim,
                result,
                agentName,
                credentialIds: chosen.map((item) => item.ID),
                identity,
                approverName: host.deviceName(),
            });
            if (!(await host.addAgentToVault(record)))
                throw new Error("Couldn't save the agent in your vault.");
            finished.current = true;
            savingRef.current = false;
            // The dialog went away during the save (the vault locked).
            if (gone.current) return;
            toast.success("Connected");
            onConnected(record.ID);
            onClose();
        } catch (caught) {
            savingRef.current = false;
            if (finished.current) return;
            const wasAnswered = answered.current !== null;
            // A request that came after the confirmation waited for the save.
            if (answered.current) host.pairingFailed(answered.current);
            answered.current = null;
            if (gone.current) return;
            setSaving(false);
            setError(
                caught instanceof PairingExpiredError
                    ? EXPIRED
                    : wasAnswered
                      ? "The agent didn't confirm the pairing. Run cryptex-agent pair again."
                      : "Couldn't connect the agent. Try again.",
            );
            setStage("paste");
            setClaim(null);
        } finally {
            if (!gone.current) setBusy(false);
        }
    };

    const title = stage === "code" ? "Check the code" : "Connect an agent";

    return (
        <DialogContent
            className="max-h-[90vh] overflow-y-auto sm:max-w-lg"
            data-testid="agent-connect-dialog"
            // Typing a code shouldn't be lost to a stray click outside.
            onInteractOutside={(event) => event.preventDefault()}
            onEscapeKeyDown={(event) => {
                if (saving) event.preventDefault();
            }}
        >
            <DialogHeader>
                <DialogTitle>{title}</DialogTitle>
                <DialogDescription>
                    {stage === "paste" ? (
                        <>
                            On the Linux machine, run{" "}
                            <code className="font-mono text-foreground">
                                cryptex-agent pair
                            </code>
                            , then paste the code it prints under the QR code.
                        </>
                    ) : stage === "relay" ? (
                        unknownRelayText(relayNeeded, "browser")
                    ) : stage === "offer" ? (
                        "Choose a name and the keys this machine can ask to use."
                    ) : (
                        "Check that the terminal shows the same code, then press Enter there."
                    )}
                </DialogDescription>
            </DialogHeader>

            {stage === "paste" ? (
                <div className="space-y-2">
                    <Label htmlFor="agent-paste">Pairing code</Label>
                    <Textarea
                        id="agent-paste"
                        data-testid="agent-paste"
                        value={code}
                        onChange={(event) => {
                            setCode(event.target.value);
                            setError("");
                        }}
                        placeholder="cryptex-pair:…"
                        rows={4}
                        autoFocus
                        spellCheck={false}
                        autoComplete="off"
                        className="break-all font-mono text-xs"
                    />
                </div>
            ) : null}

            {stage === "relay" ? (
                <div className="space-y-3">
                    <AgentInfoField
                        label="Relay"
                        testId="agent-relay-needed"
                        value={relayNeeded}
                        monospace
                        note="Named by the pairing code"
                    />
                    {otherRelays.length ? (
                        <p
                            role="alert"
                            data-testid="agent-relay-other"
                            className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-200"
                        >
                            {`You already use ${otherRelays.length === 1 ? "another relay" : "other relays"}: ${otherRelays.join(", ")}. Add this one only if you run it or trust it.`}
                        </p>
                    ) : (
                        <p className="text-sm text-muted-foreground">
                            Add it only if you run this relay or trust it.
                        </p>
                    )}
                    <div className="space-y-2">
                        <Label htmlFor="agent-relay-token">Access token</Label>
                        <PasswordInput
                            id="agent-relay-token"
                            data-testid="agent-relay-token"
                            value={relayToken}
                            secretLabel="access token"
                            autoComplete="off"
                            onChange={(event) =>
                                setRelayToken(event.target.value)
                            }
                        />
                        <p className="text-xs text-muted-foreground">
                            The relay&apos;s own token, not one from another
                            relay. Saved in your vault for this browser only.
                        </p>
                    </div>
                </div>
            ) : null}

            {stage === "offer" && claim ? (
                <div className="space-y-3">
                    <AgentInfoField
                        label="Machine"
                        value={offerMachineLabel(claim.offer)}
                        note="Reported by the machine"
                        testId="agent-offer-machine"
                    />
                    <div className="grid gap-3 sm:grid-cols-2">
                        <AgentInfoField
                            label="Agent version"
                            value={`cryptex-agent ${sanitizeDisplayText(claim.offer.agentVersion || "unknown", 32)}`}
                        />
                        <AgentInfoField
                            label="Relay"
                            value={relayLabel(
                                claim.relay.kind === "hosted"
                                    ? ""
                                    : claim.relay.url,
                            )}
                        />
                    </div>
                    <div className="space-y-2 pt-1">
                        <Label htmlFor="agent-name">Name</Label>
                        <Input
                            id="agent-name"
                            data-testid="agent-name"
                            value={name}
                            maxLength={NAME_LENGTH}
                            autoComplete="off"
                            spellCheck={false}
                            onChange={(event) => setName(event.target.value)}
                        />
                    </div>
                    <div>
                        <AgentSectionLabel
                            title="Keys this agent can use"
                            right={
                                keys.length
                                    ? `${selected.length} of ${keys.length}`
                                    : undefined
                            }
                            className="mt-4"
                        />
                        {keys.length ? (
                            <>
                                <KeyPicker
                                    keys={keys}
                                    selected={selected}
                                    disabled={busy}
                                    onChange={setSelected}
                                />
                                {selected.length ? null : (
                                    <AgentWarning testId="agent-no-keys">
                                        This agent can&apos;t use any keys yet.
                                        You can add them later with Edit keys on
                                        its page.
                                    </AgentWarning>
                                )}
                            </>
                        ) : (
                            <AgentWarning testId="agent-no-keys">
                                Your vault has no SSH keys yet. You can connect
                                the agent now and add keys later with Edit keys
                                on its page.
                            </AgentWarning>
                        )}
                    </div>
                </div>
            ) : null}

            {stage === "code" ? (
                <div className="space-y-4">
                    <div
                        className="rounded-lg border border-border bg-muted/50 py-6 text-center"
                        aria-label={`Confirmation code ${confirmation.split("").join(" ")}`}
                    >
                        <span
                            data-testid="agent-code"
                            className="select-all font-mono text-3xl tracking-[0.2em] text-foreground"
                        >
                            {confirmation}
                        </span>
                    </div>
                    <p className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
                        <Loader2
                            className="h-4 w-4 animate-spin"
                            aria-hidden="true"
                        />
                        {saving
                            ? "Saving the agent…"
                            : "Waiting for the agent…"}
                    </p>
                </div>
            ) : null}

            {error ? (
                <p className="text-sm text-destructive" role="alert">
                    {error}
                </p>
            ) : null}

            <DialogFooter className="gap-2 sm:gap-0">
                {stage === "code" ? (
                    <Button
                        variant="outline"
                        data-testid="agent-cancel"
                        disabled={saving}
                        onClick={onClose}
                    >
                        {saving ? "Saving…" : "Cancel"}
                    </Button>
                ) : stage === "offer" ? (
                    <Button
                        data-testid="agent-submit"
                        disabled={!name.trim() || busy}
                        onClick={() => void connect()}
                    >
                        {busy ? "Connecting…" : "Connect"}
                    </Button>
                ) : stage === "relay" ? (
                    <Button
                        data-testid="agent-relay-continue"
                        disabled={!relayToken.trim() || busy}
                        onClick={() => void saveRelayAndRetry()}
                    >
                        {busy ? "Checking…" : "Continue"}
                    </Button>
                ) : (
                    <Button
                        data-testid="agent-paste-submit"
                        disabled={!code.trim() || busy || !host}
                        onClick={() => void submitCode(code)}
                    >
                        {busy ? "Checking…" : "Continue"}
                    </Button>
                )}
            </DialogFooter>
        </DialogContent>
    );
}
