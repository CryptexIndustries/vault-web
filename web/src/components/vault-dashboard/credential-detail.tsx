import { useState, useEffect } from "react";
import {
    Globe,
    User,
    Key,
    Link,
    Clock,
    Shield,
    Copy,
    Eye,
    EyeOff,
    ExternalLink,
    Edit2,
    Trash2,
    FileText,
    Plus,
    Fingerprint,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "@/components/ui/tooltip";
import {
    VaultCredential,
    calculateTOTP,
} from "@cryptex-industries/vault-core/vault-utils/vault";
import {
    CustomFieldType,
    ItemType,
} from "@cryptex-industries/vault-core/proto";
import { cn } from "@/lib/utils";
import { CredentialConstants } from "@/utils/consts";
import { copySecretToClipboard } from "@/utils/clipboard";
import { PasswordStrengthMeter } from "@/components/vault-security/password-strength-meter";

interface CredentialDetailProps {
    credential: VaultCredential | null;
    onEdit: (credential: VaultCredential) => void;
    isMobile?: boolean;
    onOpenUrl: (credential: VaultCredential) => void;
    onDeleteCredential: (credential: VaultCredential) => void;
    directoryName: string;
}

function parseTags(tags?: string): string[] {
    if (!tags) return [];
    return tags
        .split(CredentialConstants.TAG_SEPARATOR)
        .map((tag) => tag.trim())
        .filter(Boolean);
}

const MAX_VISIBLE_TAGS = 3;

function CopyableField({
    label,
    value,
    icon: Icon,
    isPassword = false,
    showStrengthMeter = false,
    onOpenUrl = null,
    isCopied,
    onCopy,
}: {
    label: string;
    value: string;
    icon: React.ElementType;
    isPassword?: boolean;
    showStrengthMeter?: boolean;
    onOpenUrl?: (() => void) | null;
    isCopied: boolean;
    onCopy: () => void;
}) {
    const [showPassword, setShowPassword] = useState(false);

    return (
        <div className="group min-w-0">
            <div className="mb-1.5 flex items-center justify-between">
                <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    {label}
                </span>
            </div>
            <div className="flex min-w-0 items-center gap-2 overflow-hidden rounded-lg border border-border bg-muted/50 p-3 transition-colors group-hover:border-primary/30">
                <Icon className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
                <span
                    className={cn(
                        "block min-w-0 flex-1 font-mono text-sm text-foreground",
                        isPassword && !showPassword && "tracking-[0.25em]",
                    )}
                >
                    {isPassword && !showPassword ? "••••••••••••" : value}
                </span>
                <div className="flex shrink-0 items-center gap-1">
                    {isPassword && (
                        <TooltipProvider>
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        onClick={() =>
                                            setShowPassword(!showPassword)
                                        }
                                        className="h-7 w-7"
                                    >
                                        {showPassword ? (
                                            <EyeOff className="h-3.5 w-3.5" />
                                        ) : (
                                            <Eye className="h-3.5 w-3.5" />
                                        )}
                                    </Button>
                                </TooltipTrigger>
                                <TooltipContent>
                                    {showPassword ? "Hide" : "Show"}
                                </TooltipContent>
                            </Tooltip>
                        </TooltipProvider>
                    )}
                    {onOpenUrl && (
                        <TooltipProvider>
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        onClick={onOpenUrl}
                                        className="h-7 w-7"
                                    >
                                        <ExternalLink className="h-3.5 w-3.5" />
                                    </Button>
                                </TooltipTrigger>
                                <TooltipContent>Open website</TooltipContent>
                            </Tooltip>
                        </TooltipProvider>
                    )}
                    <TooltipProvider>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={onCopy}
                                    className={cn(
                                        "h-7 w-7",
                                        isCopied && "text-primary",
                                    )}
                                >
                                    <Copy className="h-3.5 w-3.5" />
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent>
                                {isCopied ? "Copied!" : "Copy"}
                            </TooltipContent>
                        </Tooltip>
                    </TooltipProvider>
                </div>
            </div>
            {showStrengthMeter && value.length > 0 ? (
                <PasswordStrengthMeter
                    password={value}
                    showSuggestions={false}
                    className="mt-2"
                />
            ) : null}
        </div>
    );
}

function TOTPField({ credential }: { credential: VaultCredential }) {
    const [timeLeft, setTimeLeft] = useState(30);
    const [totpCode, setTotpCode] = useState("------");
    const [isCopied, setIsCopied] = useState(false);

    useEffect(() => {
        const update = () => {
            if (!credential.TOTP?.Secret) {
                setTotpCode("------");
                return;
            }

            try {
                const { code, timeRemaining } = calculateTOTP(credential.TOTP);
                setTotpCode(code);
                setTimeLeft(timeRemaining);
            } catch {
                setTotpCode("------");
            }
        };

        update();
        const interval = setInterval(() => {
            update();
        }, 1000);
        return () => clearInterval(interval);
    }, [credential]);

    const handleCopy = () => {
        if (totpCode === "------") return;
        void copySecretToClipboard(totpCode).then((copied) => {
            if (!copied) return;
            setIsCopied(true);
            setTimeout(() => setIsCopied(false), 2000);
        });
    };

    return (
        <div className="group">
            <div className="mb-1.5 flex items-center justify-between">
                <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    Two-Factor Code
                </span>
                <div className="flex items-center gap-1.5">
                    <div
                        className={cn(
                            "h-1.5 w-1.5 rounded-full",
                            timeLeft > 10
                                ? "bg-primary"
                                : "bg-destructive animate-pulse",
                        )}
                    />
                    <span
                        className={cn(
                            "font-mono text-xs",
                            timeLeft > 10
                                ? "text-muted-foreground"
                                : "text-destructive",
                        )}
                    >
                        {timeLeft}s
                    </span>
                </div>
            </div>
            <div className="flex items-center gap-2 rounded-lg border border-primary/20 bg-primary/5 p-3">
                <Shield className="h-4 w-4 flex-shrink-0 text-primary" />
                <span className="flex-1 font-mono text-lg font-semibold tracking-[0.25em] text-primary">
                    {totpCode.slice(0, 3)} {totpCode.slice(3)}
                </span>
                <div className="flex items-center gap-2">
                    <div className="relative h-8 w-8">
                        <svg className="h-8 w-8 -rotate-90" viewBox="0 0 32 32">
                            <circle
                                cx="16"
                                cy="16"
                                r="14"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                                className="text-muted"
                            />
                            <circle
                                cx="16"
                                cy="16"
                                r="14"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                                strokeDasharray={`${(timeLeft / 30) * 88} 88`}
                                className={
                                    timeLeft > 10
                                        ? "text-primary"
                                        : "text-destructive"
                                }
                            />
                        </svg>
                    </div>
                    <TooltipProvider>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={handleCopy}
                                    className={cn(
                                        "h-7 w-7",
                                        isCopied && "text-primary",
                                    )}
                                >
                                    <Copy className="h-3.5 w-3.5" />
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent>
                                {isCopied ? "Copied!" : "Copy code"}
                            </TooltipContent>
                        </Tooltip>
                    </TooltipProvider>
                </div>
            </div>
        </div>
    );
}

function PasskeyDetails({
    credential,
    copiedField,
    onCopy,
    onOpenUrl,
}: {
    credential: VaultCredential & {
        Passkey: NonNullable<VaultCredential["Passkey"]>;
    };
    copiedField: string | null;
    onCopy: (field: string, value: string) => void;
    onOpenUrl: () => void;
}) {
    return (
        <div className="space-y-4 rounded-lg border border-primary/20 bg-primary/5 p-4">
            <div className="flex items-start gap-3">
                <Fingerprint className="mt-0.5 h-5 w-5 text-primary" />
                <div>
                    <p className="text-sm font-medium">Passwordless sign-in</p>
                    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                        Cryptex Vault will offer this passkey when{" "}
                        {credential.Passkey.RPID} requests it.
                    </p>
                </div>
            </div>
            <CopyableField
                label="Passkey account"
                value={
                    credential.Passkey.UserDisplayName ||
                    credential.Passkey.UserName
                }
                icon={User}
                isCopied={copiedField === "passkey-account"}
                onCopy={() =>
                    onCopy("passkey-account", credential.Passkey.UserName)
                }
            />
            <CopyableField
                label="Relying party"
                value={credential.Passkey.RPID}
                icon={Link}
                isCopied={copiedField === "rp-id"}
                onCopy={() => onCopy("rp-id", credential.Passkey.RPID)}
                onOpenUrl={onOpenUrl}
            />
            <div className="flex items-center justify-between rounded-lg border border-border bg-muted/50 p-3 text-sm">
                <span className="text-muted-foreground">Credential</span>
                <span className="font-mono text-xs">
                    •••• {credential.Passkey.CredentialID.slice(-8)}
                </span>
            </div>
        </div>
    );
}

export function CredentialDetail({
    credential,
    onEdit,
    isMobile,
    onOpenUrl,
    onDeleteCredential,
    directoryName,
}: CredentialDetailProps) {
    const [copiedField, setCopiedField] = useState<string | null>(null);
    const allTags = parseTags(credential?.Tags);
    const visibleTags = allTags.slice(0, MAX_VISIBLE_TAGS);
    const hiddenTags = allTags.slice(MAX_VISIBLE_TAGS);
    const hiddenTagCount = Math.max(allTags.length - MAX_VISIBLE_TAGS, 0);
    const isPasskeyOnly = credential?.Type === ItemType.Passkey;
    const hasPasskey = Boolean(credential?.Passkey);

    const handleCopy = (field: string, value: string) => {
        void copySecretToClipboard(value).then((copied) => {
            if (!copied) return;
            setCopiedField(field);
            setTimeout(() => setCopiedField(null), 2000);
        });
    };

    if (!credential) {
        return (
            <div className="flex h-svh w-96 items-center justify-center border-l border-border bg-card">
                <div className="p-8 text-center">
                    <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-muted">
                        <Key className="h-8 w-8 text-muted-foreground" />
                    </div>
                    <p className="font-medium text-foreground">
                        Select a credential
                    </p>
                    <p className="mt-1 text-sm text-muted-foreground">
                        Choose an item from the list to view its details
                    </p>
                </div>
            </div>
        );
    }

    return (
        <div
            className={cn(
                "bg-card flex flex-col",
                isMobile
                    ? "h-full w-full"
                    : "border-border h-svh w-96 border-l",
            )}
        >
            {/* Header */}
            <div className="border-b border-border p-4">
                <div className="mb-4 flex items-start justify-between">
                    <div className="flex items-center gap-3">
                        <div className="hidden h-12 w-12 items-center justify-center rounded-lg bg-muted sm:flex">
                            {isPasskeyOnly ? (
                                <Fingerprint className="h-6 w-6 text-primary" />
                            ) : (
                                <Globe className="h-6 w-6 text-muted-foreground" />
                            )}
                        </div>
                        <div>
                            <h3 className="line-clamp-2 font-semibold text-foreground">
                                {credential.Name}
                            </h3>
                            <p className="mt-0.5 text-xs text-muted-foreground">
                                Directory: {directoryName}
                            </p>
                            {hasPasskey && (
                                <Badge className="mt-1.5 gap-1 bg-primary/10 text-primary hover:bg-primary/10">
                                    <Fingerprint className="h-3 w-3" />
                                    Passkey
                                </Badge>
                            )}
                            <div className="mt-1 flex flex-wrap gap-1.5">
                                {visibleTags.map((tag) => (
                                    <Badge
                                        key={tag}
                                        variant="secondary"
                                        className="max-w-[120px] truncate text-[11px]"
                                    >
                                        {tag}
                                    </Badge>
                                ))}
                                {hiddenTagCount > 0 && (
                                    <TooltipProvider>
                                        <Tooltip>
                                            <TooltipTrigger asChild>
                                                <Badge
                                                    variant="secondary"
                                                    className="cursor-default text-[11px]"
                                                >
                                                    +{hiddenTagCount}
                                                </Badge>
                                            </TooltipTrigger>
                                            <TooltipContent className="max-w-[220px]">
                                                <div className="flex flex-wrap gap-1">
                                                    {hiddenTags.map((tag) => (
                                                        <span
                                                            key={tag}
                                                            className="rounded bg-secondary px-1.5 py-0.5 text-[11px] text-secondary-foreground"
                                                        >
                                                            {tag}
                                                        </span>
                                                    ))}
                                                </div>
                                            </TooltipContent>
                                        </Tooltip>
                                    </TooltipProvider>
                                )}
                            </div>
                        </div>
                    </div>
                </div>

                <div className="flex items-center gap-2">
                    <Button
                        onClick={() => onEdit(credential)}
                        className="flex-1 gap-2"
                    >
                        <Edit2 className="h-4 w-4" />
                        {isPasskeyOnly ? "Edit details" : "Edit"}
                    </Button>
                    {/* {credential.URL && (
                        <TooltipProvider>
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <Button
                                        variant="outline"
                                        size="icon"
                                        asChild
                                    >
                                        <a
                                            href={credential.URL}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                        >
                                            <ExternalLink className="h-4 w-4" />
                                        </a>
                                    </Button>
                                </TooltipTrigger>
                                <TooltipContent>Open website</TooltipContent>
                            </Tooltip>
                        </TooltipProvider>
                    )} */}
                    <TooltipProvider>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button
                                    variant="outline"
                                    size="icon"
                                    onClick={() =>
                                        onDeleteCredential(credential)
                                    }
                                >
                                    <Trash2 className="h-4 w-4 text-destructive" />
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent>Delete credential</TooltipContent>
                        </Tooltip>
                    </TooltipProvider>
                </div>
            </div>

            {/* Content */}
            <ScrollArea className="min-h-0 flex-1">
                <div className="w-0 min-w-full space-y-4 p-4">
                    {/* Core fields */}
                    {isPasskeyOnly && credential.Passkey ? (
                        <PasskeyDetails
                            credential={
                                credential as VaultCredential & {
                                    Passkey: NonNullable<
                                        VaultCredential["Passkey"]
                                    >;
                                }
                            }
                            copiedField={copiedField}
                            onCopy={handleCopy}
                            onOpenUrl={() => onOpenUrl(credential)}
                        />
                    ) : (
                        <>
                            <CopyableField
                                label="Username"
                                value={credential.Username}
                                icon={User}
                                isCopied={copiedField === "username"}
                                onCopy={() =>
                                    handleCopy("username", credential.Username)
                                }
                            />

                            <CopyableField
                                label="Password"
                                value={credential.Password}
                                icon={Key}
                                isPassword
                                showStrengthMeter
                                isCopied={copiedField === "password"}
                                onCopy={() =>
                                    handleCopy("password", credential.Password)
                                }
                            />

                            {credential.URL && (
                                <CopyableField
                                    label="Website"
                                    value={credential.URL}
                                    icon={Link}
                                    isCopied={copiedField === "url"}
                                    onCopy={() =>
                                        handleCopy("url", credential.URL)
                                    }
                                    onOpenUrl={() => onOpenUrl(credential)}
                                />
                            )}

                            {credential.AdditionalURLs.map((rule, index) => (
                                <CopyableField
                                    key={`${rule.URL}:${index}`}
                                    label={`Website ${index + 2}`}
                                    value={rule.URL}
                                    icon={Link}
                                    isCopied={copiedField === `url-${index}`}
                                    onCopy={() =>
                                        handleCopy(`url-${index}`, rule.URL)
                                    }
                                />
                            ))}

                            {credential.TOTP && (
                                <TOTPField credential={credential} />
                            )}
                        </>
                    )}

                    {!isPasskeyOnly && credential.Passkey && (
                        <PasskeyDetails
                            credential={
                                credential as VaultCredential & {
                                    Passkey: NonNullable<
                                        VaultCredential["Passkey"]
                                    >;
                                }
                            }
                            copiedField={copiedField}
                            onCopy={handleCopy}
                            onOpenUrl={() => onOpenUrl(credential)}
                        />
                    )}

                    {/* Description */}
                    {credential.Notes && (
                        <div>
                            <span className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-muted-foreground">
                                Notes
                            </span>
                            <div className="rounded-lg border border-border bg-muted/50 p-3">
                                <p className="text-sm text-foreground">
                                    {credential.Notes}
                                </p>
                            </div>
                        </div>
                    )}

                    {/* Custom fields */}
                    {credential.CustomFields.length > 0 && (
                        <>
                            <Separator className="my-4" />
                            <div className="mb-3 flex items-center justify-between">
                                <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                                    Custom Fields
                                </span>
                                <Badge variant="secondary" className="text-xs">
                                    {credential.CustomFields.length}
                                </Badge>
                            </div>
                            <div className="space-y-4">
                                {credential.CustomFields.map((field) => (
                                    <CopyableField
                                        key={field.ID}
                                        label={field.Name}
                                        value={field.Value}
                                        icon={
                                            field.Type === CustomFieldType.Text
                                                ? FileText
                                                : Key
                                        }
                                        isPassword={
                                            field.Type ===
                                            CustomFieldType.MaskedText
                                        }
                                        isCopied={copiedField === field.ID}
                                        onCopy={() =>
                                            handleCopy(field.ID, field.Value)
                                        }
                                    />
                                ))}
                            </div>
                        </>
                    )}

                    {/* Metadata */}
                    <Separator className="my-4" />
                    <div className="space-y-3">
                        <div className="flex items-center justify-between text-sm">
                            <span className="flex items-center gap-2 text-muted-foreground">
                                <Clock className="h-4 w-4" />
                                Last modified
                            </span>
                            <span className="text-foreground">
                                {new Date(
                                    credential.DateModifiedTimestamp ||
                                        credential.DateCreatedTimestamp,
                                ).toLocaleDateString("en-US", {
                                    month: "short",
                                    day: "numeric",
                                    year: "numeric",
                                })}
                            </span>
                        </div>
                        <div className="flex items-center justify-between text-sm">
                            <span className="flex items-center gap-2 text-muted-foreground">
                                <Plus className="h-4 w-4" />
                                Created
                            </span>
                            <span className="text-foreground">
                                {new Date(
                                    credential.DateCreatedTimestamp,
                                ).toLocaleDateString("en-US", {
                                    month: "short",
                                    day: "numeric",
                                    year: "numeric",
                                })}
                            </span>
                        </div>
                    </div>
                </div>
            </ScrollArea>
        </div>
    );
}
