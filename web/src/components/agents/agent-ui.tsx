import type { ReactNode } from "react";
import {
    AlertTriangle,
    Check,
    FileKey,
    ShieldCheck,
    SquareTerminal,
} from "lucide-react";
import {
    agentKeyOptions,
    type AgentKeyOption,
} from "@cryptex-industries/vault-core/agent/agent-format";
import { sshKeyItems } from "@cryptex-industries/vault-core/agent/vault-agents";
import type { Vault } from "@cryptex-industries/vault-core/vault-utils/vault";
import { cn } from "@/lib/utils";
import { getSSHKeyInfo } from "@/utils/ssh-key";

/** The terminal glyph of a connected agent, in the agent tint. */
export function AgentGlyph({
    variant = "row",
}: {
    variant?: "row" | "identity";
}) {
    return (
        <div
            className={cn(
                "flex shrink-0 items-center justify-center",
                variant === "identity"
                    ? "h-12 w-12 rounded-lg border border-border bg-muted"
                    : "h-8 w-8 rounded-md bg-agent/15",
            )}
        >
            <SquareTerminal
                aria-hidden="true"
                strokeWidth={1.8}
                className={cn(
                    "text-agent",
                    variant === "identity" ? "h-6 w-6" : "h-4 w-4",
                )}
            />
        </div>
    );
}

/** Uppercase section label with an optional count or action on the right. */
export function AgentSectionLabel({
    title,
    right,
    className,
}: {
    title: string;
    right?: ReactNode;
    className?: string;
}) {
    return (
        <div
            className={cn(
                "mb-2 mt-6 flex min-h-6 items-center justify-between",
                className,
            )}
        >
            <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                {title}
            </span>
            {typeof right === "string" ? (
                <span className="text-xs tabular-nums text-muted-foreground">
                    {right}
                </span>
            ) : (
                right
            )}
        </div>
    );
}

/** An amber note under a field, for a choice that has consequences. */
export function AgentWarning({
    children,
    testId,
}: {
    children: ReactNode;
    testId?: string;
}) {
    return (
        <p
            data-testid={testId}
            className="mt-2 flex gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-200"
        >
            <AlertTriangle
                className="mt-0.5 h-4 w-4 shrink-0"
                aria-hidden="true"
            />
            <span>{children}</span>
        </p>
    );
}

const HIDDEN_NOTE = "Contains hidden characters, shown as �";

/** A labelled value, styled like the fields of an item. */
export function AgentInfoField({
    label,
    value,
    note,
    badge,
    monospace,
    hidden,
    testId,
}: {
    label: string;
    value: ReactNode;
    /** A second, muted line, such as "Reported by the machine". */
    note?: string;
    badge?: ReactNode;
    monospace?: boolean;
    /** The value has hidden characters: monospace, and the note says so. */
    hidden?: boolean;
    testId?: string;
}) {
    const shownNote = hidden
        ? note
            ? `${note}. ${HIDDEN_NOTE}`
            : HIDDEN_NOTE
        : note;
    return (
        <div className="min-w-0">
            <div className="mb-1.5 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                {label}
            </div>
            <div className="overflow-hidden rounded-lg border border-border bg-muted/50 px-3 py-2.5">
                <div className="flex min-w-0 items-center gap-2">
                    <span
                        data-testid={testId}
                        className={cn(
                            "min-w-0 break-words text-sm text-foreground",
                            (monospace || hidden) &&
                                "break-all font-mono text-xs",
                        )}
                    >
                        {value}
                    </span>
                    {badge}
                </div>
                {shownNote ? (
                    <p className="mt-1 text-xs text-muted-foreground">
                        {shownNote}
                    </p>
                ) : null}
            </div>
        </div>
    );
}

export function VerifiedBadge() {
    return (
        <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-400">
            <ShieldCheck className="h-3 w-3" aria-hidden="true" />
            verified
        </span>
    );
}

/** The vault's SSH key items, as the key pickers list them. */
export const vaultKeyOptions = (vault: Pick<Vault, "Credentials">) =>
    agentKeyOptions(sshKeyItems(vault), (credential) =>
        getSSHKeyInfo(credential.SSHKey),
    );

/** An icon in a circle and two lines: the body of the agent list rows. */
function RowBody({
    icon: Icon = FileKey,
    title,
    detail,
    monospace = true,
}: {
    icon?: typeof FileKey;
    title: string;
    detail: string;
    monospace?: boolean;
}) {
    return (
        <>
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted">
                <Icon
                    className="h-4 w-4 text-muted-foreground"
                    aria-hidden="true"
                />
            </span>
            <span className="min-w-0 flex-1">
                <span
                    className="block truncate text-sm text-foreground"
                    title={title}
                >
                    {title}
                </span>
                <span
                    className={cn(
                        "block truncate text-xs text-muted-foreground",
                        monospace && "font-mono",
                    )}
                >
                    {detail}
                </span>
            </span>
        </>
    );
}

/** A row in the agent page's key and request lists. */
export function AgentRow(props: Parameters<typeof RowBody>[0]) {
    return (
        <div className="flex items-center gap-3 border-b border-border px-1 py-2.5 last:border-b-0">
            <RowBody {...props} />
        </div>
    );
}

/**
 * The key picker: the whole row toggles a key, a filled check circle marks
 * it chosen. Not a checkbox or a switch (the agreed design).
 */
export function KeyPicker({
    keys,
    selected,
    disabled,
    onChange,
}: {
    keys: AgentKeyOption[];
    selected: string[];
    disabled: boolean;
    onChange: (selected: string[]) => void;
}) {
    return (
        <div className="rounded-lg border border-border px-2">
            {keys.map((option) => {
                const chosen = selected.includes(option.id);
                return (
                    <button
                        key={option.id}
                        type="button"
                        aria-pressed={chosen}
                        disabled={disabled}
                        data-testid={`agent-key-${option.fingerprint}`}
                        onClick={() =>
                            onChange(
                                chosen
                                    ? selected.filter((id) => id !== option.id)
                                    : [...selected, option.id],
                            )
                        }
                        className="flex w-full items-center gap-3 border-b border-border px-1 py-2.5 text-left transition-colors last:border-b-0 hover:bg-muted/40 disabled:opacity-60"
                    >
                        <RowBody title={option.name} detail={option.detail} />
                        <span
                            aria-hidden="true"
                            className={cn(
                                "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border",
                                chosen
                                    ? "border-primary bg-primary text-primary-foreground"
                                    : "border-input",
                            )}
                        >
                            {chosen ? (
                                <Check className="h-3 w-3" strokeWidth={3} />
                            ) : null}
                        </span>
                    </button>
                );
            })}
        </div>
    );
}
