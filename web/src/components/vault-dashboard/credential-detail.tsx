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
} from "@/app_lib/vault-utils/vault";
import { CustomFieldType } from "@/app_lib/proto/vault";
import { cn } from "@/lib/utils";
import { CredentialConstants } from "@/utils/consts";

interface CredentialDetailProps {
    credential: VaultCredential | null;
    onEdit: (credential: VaultCredential) => void;
    onClose: () => void;
    isMobile?: boolean;
    onCopyUsername: (credential: VaultCredential) => void;
    onCopyPassword: (credential: VaultCredential) => void;
    onCopyTOTP: (credential: VaultCredential) => void;
    onOpenUrl: (credential: VaultCredential) => void;
    onDeleteCredential: (credential: VaultCredential) => void;
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
    onOpenUrl = null,
    isCopied,
    onCopy,
}: {
    label: string;
    value: string;
    icon: React.ElementType;
    isPassword?: boolean;
    onOpenUrl?: (() => void) | null;
    isCopied: boolean;
    onCopy: () => void;
}) {
    const [showPassword, setShowPassword] = useState(false);

    return (
        <div className="group min-w-0">
            <div className="mb-1.5 flex items-center justify-between">
                <span className="text-muted-foreground text-xs font-medium uppercase tracking-wider">
                    {label}
                </span>
            </div>
            <div className="bg-muted/50 border-border group-hover:border-primary/30 flex min-w-0 items-center gap-2 overflow-hidden rounded-lg border p-3 transition-colors">
                <Icon className="text-muted-foreground h-4 w-4 flex-shrink-0" />
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
                                <TooltipContent>
                                    Open website
                                </TooltipContent>
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
        navigator.clipboard.writeText(totpCode);
        setIsCopied(true);
        setTimeout(() => setIsCopied(false), 2000);
    };

    return (
        <div className="group">
            <div className="mb-1.5 flex items-center justify-between">
                <span className="text-muted-foreground text-xs font-medium uppercase tracking-wider">
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
            <div className="bg-primary/5 border-primary/20 flex items-center gap-2 rounded-lg border p-3">
                <Shield className="text-primary h-4 w-4 flex-shrink-0" />
                <span className="text-primary flex-1 font-mono text-lg font-semibold tracking-[0.25em]">
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

export function CredentialDetail({
    credential,
    onEdit,
    onClose,
    isMobile,
    onCopyUsername,
    onCopyPassword,
    onCopyTOTP,
    onOpenUrl,
    onDeleteCredential,
}: CredentialDetailProps) {
    const [copiedField, setCopiedField] = useState<string | null>(null);
    const allTags = parseTags(credential?.Tags);
    const visibleTags = allTags.slice(0, MAX_VISIBLE_TAGS);
    const hiddenTags = allTags.slice(MAX_VISIBLE_TAGS);
    const hiddenTagCount = Math.max(allTags.length - MAX_VISIBLE_TAGS, 0);

    const handleCopy = (field: string, value: string) => {
        navigator.clipboard.writeText(value);
        setCopiedField(field);
        setTimeout(() => setCopiedField(null), 2000);
    };

    if (!credential) {
        return (
            <div className="border-border bg-card flex h-screen w-96 items-center justify-center border-l">
                <div className="p-8 text-center">
                    <div className="bg-muted mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full">
                        <Key className="text-muted-foreground h-8 w-8" />
                    </div>
                    <p className="text-foreground font-medium">
                        Select a credential
                    </p>
                    <p className="text-muted-foreground mt-1 text-sm">
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
                    : "border-border h-screen w-96 border-l",
            )}
        >
            {/* Header */}
            <div className="border-border border-b p-4">
                <div className="mb-4 flex items-start justify-between">
                    <div className="flex items-center gap-3">
                        <div className="bg-muted h-12 w-12 items-center justify-center rounded-lg hidden sm:flex">
                            <Globe className="text-muted-foreground h-6 w-6" />
                        </div>
                        <div>
                            <h3 className="text-foreground font-semibold line-clamp-2">
                                {credential.Name}
                            </h3>
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
                                                            className="bg-secondary text-secondary-foreground rounded px-1.5 py-0.5 text-[11px]"
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
                        Edit
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
                                <Button variant="outline" size="icon" onClick={() => onDeleteCredential(credential)}>
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
                            onCopy={() => handleCopy("url", credential.URL)}
                            onOpenUrl={() => onOpenUrl(credential)}
                        />
                    )}

                    {credential.TOTP && <TOTPField credential={credential} />}

                    {/* Description */}
                    {credential.Notes && (
                        <div>
                            <span className="text-muted-foreground mb-1.5 block text-xs font-medium uppercase tracking-wider">
                                Notes
                            </span>
                            <div className="bg-muted/50 border-border rounded-lg border p-3">
                                <p className="text-foreground text-sm">
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
                                <span className="text-muted-foreground text-xs font-medium uppercase tracking-wider">
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
                            <span className="text-muted-foreground flex items-center gap-2">
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
                            <span className="text-muted-foreground flex items-center gap-2">
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
