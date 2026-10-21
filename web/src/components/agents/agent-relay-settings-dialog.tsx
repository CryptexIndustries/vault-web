import { useState } from "react";
import { ChevronRight, Cloud, Server } from "lucide-react";
import { toast } from "sonner";
import {
    normalizeRelayUrlInput,
    type CustomRelay,
} from "@cryptex-industries/vault-core/agent/runtime";
import { hostedRelayUrl } from "@/app_lib/agent/browser-agent-host";
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
import { isCloudServicesEnabled } from "@/utils/online-services-api-url";
import { useAgentHost } from "./agent-host-context";
import { AgentSectionLabel } from "./agent-ui";

const hostOf = (origin: string) => {
    try {
        return new URL(origin).host;
    } catch {
        return origin;
    }
};

/** "example.com/relay": the host, and the path when the relay has one. */
const relayDisplay = (url: string) => {
    try {
        const parsed = new URL(url);
        return `${parsed.host}${parsed.pathname.replace(/\/$/, "")}`;
    } catch {
        return url;
    }
};

function RelayRow({
    icon: Icon,
    title,
    subtitle,
    testId,
    onClick,
}: {
    icon: typeof Server;
    title: string;
    subtitle: string;
    testId?: string;
    onClick?: () => void;
}) {
    const content = (
        <>
            <Icon
                className="h-5 w-5 shrink-0 text-muted-foreground"
                strokeWidth={1.7}
            />
            <span className="min-w-0 flex-1">
                <span className="block truncate text-sm text-foreground">
                    {title}
                </span>
                <span className="block truncate text-xs text-muted-foreground">
                    {subtitle}
                </span>
            </span>
            {onClick ? (
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
            ) : null}
        </>
    );
    const className =
        "flex w-full items-center gap-3 border-b border-border px-1 py-3 text-left last:border-b-0";
    return onClick ? (
        <button
            type="button"
            data-testid={testId}
            onClick={onClick}
            className={`${className} transition-colors hover:bg-muted/40`}
        >
            {content}
        </button>
    ) : (
        <div className={className}>{content}</div>
    );
}

/** How connected agents reach this browser, from the gear next to Connected Agents. */
export function AgentRelaySettingsDialog({
    open,
    onOpenChange,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
}) {
    const host = useAgentHost();
    const [editing, setEditing] = useState<CustomRelay | "new" | null>(null);
    const [url, setUrl] = useState("");
    const [token, setToken] = useState("");
    const [error, setError] = useState("");
    const [saving, setSaving] = useState(false);
    const relays = host?.customRelays() ?? [];

    const edit = (relay: CustomRelay | "new") => {
        setEditing(relay);
        setUrl(relay === "new" ? "" : relay.origin);
        setToken(relay === "new" ? "" : relay.token);
        setError("");
    };

    const save = async () => {
        if (!host) return;
        const origin = normalizeRelayUrlInput(url);
        if (!origin) {
            setError(
                "Enter a full https:// address, like https://relay.example.com.",
            );
            return;
        }
        if (!token.trim()) {
            setError("Enter the relay's access token.");
            return;
        }
        setSaving(true);
        try {
            await host.saveCustomRelay(
                { origin, token: token.trim() },
                editing && editing !== "new" ? editing.origin : undefined,
            );
            setEditing(null);
        } catch {
            toast.error("Couldn't save the relay.");
        } finally {
            setSaving(false);
        }
    };

    const remove = async () => {
        if (!host || !editing || editing === "new") return;
        setSaving(true);
        try {
            await host.removeCustomRelay(editing.origin);
            setEditing(null);
            toast.success("Relay removed");
        } catch {
            toast.error("Couldn't remove the relay.");
        } finally {
            setSaving(false);
        }
    };

    return (
        <Dialog
            open={open}
            onOpenChange={(next) => {
                if (saving) return;
                if (!next) setEditing(null);
                onOpenChange(next);
            }}
        >
            <DialogContent
                className="max-h-[90vh] overflow-y-auto sm:max-w-lg"
                data-testid="agent-relays"
            >
                {editing ? (
                    <>
                        <DialogHeader>
                            <DialogTitle>
                                {editing === "new" ? "Add relay" : "Edit relay"}
                            </DialogTitle>
                            <DialogDescription>
                                A relay-server you run in token mode. The token
                                is saved in your vault for this browser only.
                            </DialogDescription>
                        </DialogHeader>
                        <div className="space-y-2">
                            <Label htmlFor="agent-relay-url">Relay URL</Label>
                            <Input
                                id="agent-relay-url"
                                data-testid="agent-relay-url"
                                value={url}
                                inputMode="url"
                                autoComplete="off"
                                spellCheck={false}
                                placeholder="https://relay.example.com"
                                onChange={(event) => {
                                    setUrl(event.target.value);
                                    setError("");
                                }}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="agent-relay-token-field">
                                Access token
                            </Label>
                            <PasswordInput
                                id="agent-relay-token-field"
                                data-testid="agent-relay-token"
                                value={token}
                                secretLabel="access token"
                                autoComplete="off"
                                onChange={(event) => {
                                    setToken(event.target.value);
                                    setError("");
                                }}
                            />
                        </div>
                        {error ? (
                            <p
                                className="text-sm text-destructive"
                                role="alert"
                            >
                                {error}
                            </p>
                        ) : null}
                        <DialogFooter className="gap-2 sm:gap-0">
                            {editing !== "new" ? (
                                <Button
                                    variant="destructive"
                                    disabled={saving}
                                    onClick={() => void remove()}
                                >
                                    Remove relay
                                </Button>
                            ) : null}
                            <Button
                                variant="outline"
                                disabled={saving}
                                onClick={() => setEditing(null)}
                            >
                                Back
                            </Button>
                            <Button
                                data-testid="agent-relay-save"
                                disabled={saving}
                                onClick={() => void save()}
                            >
                                {saving ? "Saving…" : "Save"}
                            </Button>
                        </DialogFooter>
                    </>
                ) : (
                    <>
                        <DialogHeader>
                            <DialogTitle>Agent relays</DialogTitle>
                            <DialogDescription>
                                Connected agents reach this browser through a
                                relay. The agent picks it when you run
                                cryptex-agent pair, and keeps the relay it was
                                paired on.
                            </DialogDescription>
                        </DialogHeader>
                        <div>
                            <AgentSectionLabel
                                title="Hosted"
                                className="mt-0"
                            />
                            <RelayRow
                                icon={Cloud}
                                title="Online Services"
                                subtitle={
                                    isCloudServicesEnabled()
                                        ? `${hostOf(hostedRelayUrl())}, included with Online Services`
                                        : "Not available in this app"
                                }
                            />
                            <AgentSectionLabel
                                title="Your own relays"
                                right={String(relays.length)}
                            />
                            {relays.length ? (
                                <div className="rounded-lg border border-border px-2">
                                    {relays.map((relay) => (
                                        <RelayRow
                                            key={relay.origin}
                                            icon={Server}
                                            testId={`agent-relay-${hostOf(relay.origin)}`}
                                            title={relayDisplay(relay.origin)}
                                            subtitle="Access token saved for this browser"
                                            onClick={() => edit(relay)}
                                        />
                                    ))}
                                </div>
                            ) : (
                                <p className="text-sm text-muted-foreground">
                                    No relays of your own yet. Add one to pair
                                    agents through a relay-server you run.
                                </p>
                            )}
                        </div>
                        <DialogFooter>
                            <Button
                                variant="outline"
                                data-testid="agent-relay-add"
                                onClick={() => edit("new")}
                            >
                                Add relay
                            </Button>
                        </DialogFooter>
                    </>
                )}
            </DialogContent>
        </Dialog>
    );
}
