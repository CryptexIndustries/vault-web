import { useState, useEffect, useRef, useCallback } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { Controller, useFieldArray, useForm } from "react-hook-form";
import {
    Plus,
    Trash2,
    X,
    Eye,
    EyeOff,
    RefreshCw,
    Loader2,
    Key,
    User,
    FileText,
    Globe,
    GripVertical,
    Fingerprint,
    QrCode,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
    ControlWithActions,
    plainFieldClassName,
} from "@/components/ui/control-with-actions";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
    Sheet,
    SheetContent,
    SheetHeader,
    SheetTitle,
    SheetDescription,
    SheetFooter,
} from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "@/components/ui/tooltip";
import {
    CredentialFormSchema,
    CredentialFormSchemaType,
    Directory,
    parseTOTPURI,
    VaultCredential,
} from "@cryptex-industries/vault-core/vault-utils/vault";
import {
    CredentialURLMatchMode,
    CustomFieldType,
    ItemType,
    TOTPAlgorithm,
} from "@cryptex-industries/vault-core/proto";
import { cn } from "@/lib/utils";
import { CredentialConstants, TOTPConstants } from "@/utils/consts";
import { PasswordGeneratorDialog } from "@/components/ui/password-generator";
import { PasswordStrengthMeter } from "@/components/vault-security/password-strength-meter";
import {
    WarningDialog,
    WarningDialogShowFn,
} from "@/components/dialog/warning";
import {
    DirectoryEditorDialog,
    DirectoryPicker,
} from "@/components/vault-dashboard/directory-dialogs";
import { CredentialURLRulesEditor } from "@/components/vault-dashboard/credential-url-rules";
import BarcodeScanner from "@/components/general/qr-scanner";

interface EditDrawerProps {
    credential: VaultCredential | null;
    isOpen: boolean;
    onClose: () => void;
    onSave: (form: CredentialFormSchemaType) => Promise<boolean>;
    directories: Directory[];
    initialDirectoryID?: string;
    onCreateDirectory: (name: string) => Promise<string | void> | string | void;
}

function TagControl({
    value,
    onChange,
}: {
    value?: string;
    onChange: (tags: string) => void;
}) {
    const tagSeparator = CredentialConstants.TAG_SEPARATOR;
    const [inputValue, setInputValue] = useState("");
    const tagInputRef = useRef<HTMLInputElement>(null);
    const tagArrayValue = (value ?? "")
        .split(tagSeparator)
        .map((tag) => tag.trim())
        .filter(Boolean);

    const addTag = (rawTag: string) => {
        const tag = rawTag.replaceAll(tagSeparator, "").trim();
        if (!tag) return;
        if (tagArrayValue.includes(tag)) return;
        onChange([...tagArrayValue, tag].join(tagSeparator));
        setInputValue("");
    };

    const removeTag = (tagToRemove: string) => {
        const nextTags = tagArrayValue.filter((tag) => tag !== tagToRemove);
        onChange(nextTags.join(tagSeparator));
        tagInputRef.current?.focus();
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === "Enter" || e.key === ",") {
            e.preventDefault();
            addTag(inputValue);
        }

        if (e.key === "Backspace" && inputValue.length === 0) {
            const lastTag = tagArrayValue[tagArrayValue.length - 1];
            if (lastTag) {
                e.preventDefault();
                removeTag(lastTag);
            }
        }
    };

    return (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-muted/30 p-2">
            {tagArrayValue.map((tag) => (
                <span
                    key={tag}
                    className="inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-1 text-xs text-secondary-foreground"
                >
                    {tag}
                    <button
                        type="button"
                        onClick={() => removeTag(tag)}
                        className="text-muted-foreground hover:text-foreground"
                        aria-label={`Remove ${tag} tag`}
                    >
                        <X className="h-3 w-3" />
                    </button>
                </span>
            ))}

            <div className="flex min-w-[140px] flex-1 items-center gap-1">
                <Input
                    ref={tagInputRef}
                    value={inputValue}
                    onChange={(e) => setInputValue(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="Add tag"
                    className="h-8 border-0 bg-transparent p-0 text-sm shadow-none focus-visible:ring-0"
                />
                <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={() => addTag(inputValue)}
                    aria-label="Add tag"
                >
                    <Plus className="h-3.5 w-3.5" />
                </Button>
            </div>
        </div>
    );
}

export function EditDrawer({
    credential,
    isOpen,
    onClose,
    onSave,
    directories,
    initialDirectoryID = "",
    onCreateDirectory,
}: EditDrawerProps) {
    const isNew = !credential;

    const [showPassword, setShowPassword] = useState(false);
    const [isPasswordGeneratorOpen, setIsPasswordGeneratorOpen] =
        useState(false);
    const [directoryEditorOpen, setDirectoryEditorOpen] = useState(false);
    const [revealedCustomFieldIds, setRevealedCustomFieldIds] = useState<
        Record<string, boolean>
    >({});
    const [isTotpScanning, setIsTotpScanning] = useState(false);
    const [totpScanError, setTotpScanError] = useState("");

    // Sample the selected directory only when seeding a new form. Creating a
    // directory updates the parent selection, and that must not rebuild these
    // defaults while the drawer is already open with in-progress edits.
    const initialDirectoryIDRef = useRef(initialDirectoryID);
    initialDirectoryIDRef.current = initialDirectoryID;

    const buildDefaultValues = useCallback(
        (): CredentialFormSchemaType => ({
            ID: null,
            Type: ItemType.Credentials,
            DirectoryID: initialDirectoryIDRef.current,
            Name: "",
            Username: "",
            Password: "",
            TOTP: null,
            Tags: "",
            URL: "",
            URLMatchMode: CredentialURLMatchMode.ExactHost,
            AdditionalURLs: [],
            Notes: "",
            CustomFields: [],
        }),
        [],
    );

    const {
        register,
        control,
        reset,
        handleSubmit,
        setValue,
        watch,
        formState: { errors, isSubmitting, isDirty },
    } = useForm<CredentialFormSchemaType>({
        resolver: zodResolver(CredentialFormSchema),
        defaultValues: buildDefaultValues(),
    });

    const {
        fields: customFields,
        append,
        remove,
    } = useFieldArray({
        control,
        name: "CustomFields",
    });

    const watchedTotp = watch("TOTP");
    const watchedPassword = watch("Password");
    const watchedType = watch("Type");
    const isPasskeyOnly = watchedType === ItemType.Passkey;
    const hasPasskey = Boolean(watch("Passkey"));
    const showWarningDialogFnRef = useRef<WarningDialogShowFn | null>(null);

    useEffect(() => {
        if (credential) {
            reset({
                ID: credential.ID,
                Type: credential.Type,
                DirectoryID: credential.DirectoryID,
                Name: credential.Name,
                Username: credential.Username,
                Password: credential.Password,
                URL: credential.URL,
                URLMatchMode: credential.URLMatchMode,
                AdditionalURLs: credential.AdditionalURLs,
                Passkey: credential.Passkey ?? null,
                Notes: credential.Notes,
                Tags: credential.Tags || "",
                TOTP: credential.TOTP ?? null,
                CustomFields: credential.CustomFields,
            });
        } else {
            reset(buildDefaultValues());
        }

        setShowPassword(false);
        setRevealedCustomFieldIds({});
        setIsTotpScanning(false);
        setTotpScanError("");
    }, [buildDefaultValues, credential, isOpen, reset]);

    const handleAddCustomField = () => {
        append({
            ID: `custom-${Date.now()}`,
            Name: "",
            Type: CustomFieldType.Text,
            Value: "",
        });
    };

    const toggleCustomFieldReveal = (fieldId: string) => {
        setRevealedCustomFieldIds((prev) => ({
            ...prev,
            [fieldId]: !prev[fieldId],
        }));
    };

    const handleGeneratedPasswordSelect = (newPassword: string) => {
        setValue("Password", newPassword, {
            shouldDirty: true,
            shouldValidate: true,
        });
        setShowPassword(true);
    };

    const handleTotpScan = (value: string) => {
        try {
            const totp = parseTOTPURI(value);
            setValue(
                "TOTP",
                {
                    Label: totp.Label,
                    Secret: totp.Secret,
                    Period: totp.Period,
                    Digits: totp.Digits,
                    Algorithm: totp.Algorithm,
                },
                {
                    shouldDirty: true,
                    shouldValidate: true,
                },
            );
            setTotpScanError("");
            setIsTotpScanning(false);
        } catch {
            setTotpScanError("This QR code does not contain a valid TOTP URI.");
        }
    };

    const handleTotpToggle = (enabled: boolean) => {
        setIsTotpScanning(false);
        setTotpScanError("");

        if (!enabled) {
            setValue("TOTP", null, {
                shouldDirty: true,
                shouldValidate: true,
            });
            return;
        }

        setValue(
            "TOTP",
            watchedTotp ?? {
                Label: "",
                Secret: "",
                Period: TOTPConstants.PERIOD_DEFAULT,
                Digits: TOTPConstants.DIGITS_DEFAULT,
                Algorithm: TOTPConstants.ALGORITHM_DEFAULT,
            },
            {
                shouldDirty: true,
                shouldValidate: true,
            },
        );
    };

    const onSubmit = async (formData: CredentialFormSchemaType) => {
        await new Promise((resolve) => setTimeout(resolve, 200));

        const normalizedFormData: CredentialFormSchemaType = {
            ...formData,
            Tags: formData.Tags ?? "",
            CustomFields: formData.CustomFields.filter(
                (field) => field.Name.trim() && field.Value.trim(),
            ),
        };

        if (await onSave(normalizedFormData)) {
            onClose();
        }
    };

    const requestClose = () => {
        if (isSubmitting) return;

        if (isDirty) {
            showWarningDialogFnRef.current?.(
                "You have unsaved changes.",
                () => onClose(),
                null,
                "Discard changes",
            );
            return;
        }

        onClose();
    };

    return (
        <>
            <Sheet
                open={isOpen}
                onOpenChange={(open) => {
                    if (!open) requestClose();
                }}
            >
                <SheetContent
                    side="right"
                    className="flex w-full flex-col p-0 sm:max-w-lg"
                >
                    <SheetHeader className="border-b border-border p-6 pb-4">
                        <SheetTitle className="text-lg">
                            {isNew
                                ? "Add New Credential"
                                : isPasskeyOnly
                                  ? "Edit Passkey"
                                  : "Edit Credential"}
                        </SheetTitle>
                        <SheetDescription>
                            {isNew
                                ? "Add a new credential to your secure vault"
                                : "Update the details of this credential"}
                        </SheetDescription>
                    </SheetHeader>

                    <ScrollArea className="flex-1">
                        <div className="space-y-6 p-6">
                            {/* Basic Info */}
                            <div className="space-y-4">
                                {hasPasskey && (
                                    <div className="rounded-lg border border-primary/20 bg-primary/5 p-4">
                                        <div className="flex items-start gap-3">
                                            <Fingerprint className="mt-0.5 h-5 w-5 text-primary" />
                                            <div>
                                                <p className="text-sm font-medium">
                                                    Passkey
                                                </p>
                                                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                                                    This passkey was created by
                                                    the Cryptex Vault browser
                                                    extension. Its private key
                                                    stays encrypted and cannot
                                                    be viewed or copied.
                                                </p>
                                            </div>
                                        </div>
                                    </div>
                                )}

                                <div className="space-y-2">
                                    <Label
                                        htmlFor="name"
                                        className="text-sm font-medium"
                                    >
                                        Name{" "}
                                        <span className="text-destructive">
                                            *
                                        </span>
                                    </Label>
                                    <div className="relative">
                                        <Globe className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                                        <Input
                                            id="name"
                                            placeholder="e.g., GitHub, AWS Console"
                                            {...register("Name")}
                                            className={cn(
                                                "pl-10",
                                                errors.Name &&
                                                    "border-destructive",
                                            )}
                                        />
                                    </div>
                                    {errors.Name && (
                                        <p className="text-xs text-destructive">
                                            {errors.Name.message}
                                        </p>
                                    )}
                                </div>

                                <div className="space-y-2">
                                    <Label className="text-sm font-medium">
                                        Directory
                                    </Label>
                                    <Controller
                                        control={control}
                                        name="DirectoryID"
                                        render={({ field }) => (
                                            <DirectoryPicker
                                                directories={directories}
                                                value={field.value}
                                                onChange={field.onChange}
                                            />
                                        )}
                                    />
                                    <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        className="w-full gap-1.5"
                                        onClick={() =>
                                            setDirectoryEditorOpen(true)
                                        }
                                    >
                                        <Plus className="h-3.5 w-3.5" />
                                        New directory
                                    </Button>
                                </div>

                                {!isPasskeyOnly && (
                                    <>
                                        <div className="space-y-2">
                                            <Label
                                                htmlFor="username"
                                                className="text-sm font-medium"
                                            >
                                                Username / Email{" "}
                                                <span className="text-destructive">
                                                    *
                                                </span>
                                            </Label>
                                            <div className="relative">
                                                <User className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                                                <Input
                                                    id="username"
                                                    placeholder="username@email.com"
                                                    {...register("Username")}
                                                    className={cn(
                                                        "pl-10",
                                                        errors.Username &&
                                                            "border-destructive",
                                                    )}
                                                />
                                            </div>
                                            {errors.Username && (
                                                <p className="text-xs text-destructive">
                                                    {errors.Username.message}
                                                </p>
                                            )}
                                        </div>

                                        <div className="space-y-2">
                                            <Label
                                                htmlFor="password"
                                                className="text-sm font-medium"
                                            >
                                                Password{" "}
                                                <span className="text-destructive">
                                                    *
                                                </span>
                                            </Label>
                                            <ControlWithActions
                                                className={cn(
                                                    errors.Password &&
                                                        "border-destructive",
                                                )}
                                                actions={
                                                    <div className="flex items-center gap-1 pr-1">
                                                        <TooltipProvider>
                                                            <Tooltip>
                                                                <TooltipTrigger
                                                                    asChild
                                                                >
                                                                    <Button
                                                                        type="button"
                                                                        variant="ghost"
                                                                        size="icon"
                                                                        onClick={() =>
                                                                            setShowPassword(
                                                                                !showPassword,
                                                                            )
                                                                        }
                                                                        className="h-7 w-7"
                                                                        aria-label={
                                                                            showPassword
                                                                                ? "Hide password"
                                                                                : "Show password"
                                                                        }
                                                                    >
                                                                        {showPassword ? (
                                                                            <EyeOff className="h-3.5 w-3.5" />
                                                                        ) : (
                                                                            <Eye className="h-3.5 w-3.5" />
                                                                        )}
                                                                    </Button>
                                                                </TooltipTrigger>
                                                                <TooltipContent>
                                                                    {showPassword
                                                                        ? "Hide"
                                                                        : "Show"}
                                                                </TooltipContent>
                                                            </Tooltip>
                                                        </TooltipProvider>
                                                        <TooltipProvider>
                                                            <Tooltip>
                                                                <TooltipTrigger
                                                                    asChild
                                                                >
                                                                    <Button
                                                                        type="button"
                                                                        variant="ghost"
                                                                        size="icon"
                                                                        onClick={() =>
                                                                            setIsPasswordGeneratorOpen(
                                                                                true,
                                                                            )
                                                                        }
                                                                        className="h-7 w-7"
                                                                        aria-label="Generate password"
                                                                    >
                                                                        <RefreshCw className="h-3.5 w-3.5" />
                                                                    </Button>
                                                                </TooltipTrigger>
                                                                <TooltipContent>
                                                                    Generate
                                                                    password
                                                                </TooltipContent>
                                                            </Tooltip>
                                                        </TooltipProvider>
                                                    </div>
                                                }
                                            >
                                                <div className="flex h-full min-w-0 items-center">
                                                    <Key className="ml-3 h-4 w-4 shrink-0 text-muted-foreground" />
                                                    <Input
                                                        id="password"
                                                        type={
                                                            showPassword
                                                                ? "text"
                                                                : "password"
                                                        }
                                                        placeholder="Enter password"
                                                        {...register(
                                                            "Password",
                                                        )}
                                                        className={cn(
                                                            plainFieldClassName,
                                                            "h-full w-auto min-w-0 flex-1 pl-3 font-mono",
                                                        )}
                                                    />
                                                </div>
                                            </ControlWithActions>
                                            {errors.Password && (
                                                <p className="text-xs text-destructive">
                                                    {errors.Password.message}
                                                </p>
                                            )}
                                            <PasswordStrengthMeter
                                                password={watchedPassword}
                                            />
                                        </div>
                                    </>
                                )}

                                {hasPasskey && credential?.Passkey && (
                                    <div className="space-y-3 rounded-lg border border-border bg-muted/30 p-4">
                                        <div>
                                            <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                                                Account
                                            </Label>
                                            <p className="mt-1 text-sm">
                                                {credential.Passkey
                                                    .UserDisplayName ||
                                                    credential.Passkey.UserName}
                                            </p>
                                        </div>
                                        <div>
                                            <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                                                Relying party
                                            </Label>
                                            <p className="mt-1 font-mono text-sm">
                                                {credential.Passkey.RPID}
                                            </p>
                                        </div>
                                    </div>
                                )}

                                <CredentialURLRulesEditor
                                    control={control}
                                    errors={errors}
                                    register={register}
                                />

                                <div className="space-y-2">
                                    <Label
                                        htmlFor="category"
                                        className="text-sm font-medium"
                                    >
                                        Tags
                                    </Label>
                                    <Controller
                                        control={control}
                                        name="Tags"
                                        render={({ field }) => (
                                            <TagControl
                                                value={field.value}
                                                onChange={field.onChange}
                                            />
                                        )}
                                    />
                                    <p className="text-xs text-muted-foreground">
                                        Press Enter or comma to add a tag
                                    </p>
                                </div>

                                <div className="space-y-2">
                                    <Label
                                        htmlFor="description"
                                        className="text-sm font-medium"
                                    >
                                        Notes
                                    </Label>
                                    <Textarea
                                        id="description"
                                        placeholder="Add any additional notes..."
                                        {...register("Notes")}
                                        className="min-h-[80px] resize-none"
                                    />
                                </div>
                            </div>

                            {/* Two-Factor Auth */}
                            <Separator />
                            <div className="flex items-center justify-between">
                                <div className="space-y-0.5">
                                    <Label className="text-sm font-medium">
                                        Two-Factor Authentication
                                    </Label>
                                    <p className="text-xs text-muted-foreground">
                                        Enable TOTP for this credential
                                    </p>
                                </div>
                                <Switch
                                    aria-label="Enable TOTP"
                                    checked={!!watchedTotp}
                                    onCheckedChange={handleTotpToggle}
                                />
                            </div>
                            {watchedTotp && (
                                <div className="space-y-3 rounded-lg border p-3">
                                    <div className="space-y-2">
                                        <div className="flex items-center justify-between gap-3">
                                            <p className="text-xs text-muted-foreground">
                                                Enter the secret or scan the QR
                                                code from the service.
                                            </p>
                                            <Button
                                                type="button"
                                                variant="outline"
                                                size="sm"
                                                onClick={() => {
                                                    setTotpScanError("");
                                                    setIsTotpScanning(
                                                        (scanning) => !scanning,
                                                    );
                                                }}
                                            >
                                                {isTotpScanning ? (
                                                    <X className="mr-2 h-4 w-4" />
                                                ) : (
                                                    <QrCode className="mr-2 h-4 w-4" />
                                                )}
                                                {isTotpScanning
                                                    ? "Stop scanning"
                                                    : "Scan QR code"}
                                            </Button>
                                        </div>
                                        {isTotpScanning && (
                                            <div className="overflow-hidden rounded-md border bg-muted/20">
                                                <BarcodeScanner
                                                    onUpdate={(_, result) => {
                                                        if (result) {
                                                            handleTotpScan(
                                                                result.getText(),
                                                            );
                                                        }
                                                    }}
                                                    onError={() => {
                                                        setTotpScanError(
                                                            "Camera unavailable. Enter the TOTP secret manually.",
                                                        );
                                                        setIsTotpScanning(
                                                            false,
                                                        );
                                                    }}
                                                />
                                            </div>
                                        )}
                                        {totpScanError && (
                                            <p
                                                className="text-xs text-destructive"
                                                role="alert"
                                            >
                                                {totpScanError}
                                            </p>
                                        )}
                                    </div>
                                    <div className="space-y-2">
                                        <Label htmlFor="totp-secret">
                                            TOTP Secret
                                        </Label>
                                        <Input
                                            id="totp-secret"
                                            placeholder="Base32 secret"
                                            {...register("TOTP.Secret")}
                                        />
                                        {errors.TOTP?.Secret && (
                                            <p className="text-xs text-destructive">
                                                {errors.TOTP.Secret.message}
                                            </p>
                                        )}
                                    </div>
                                    <div className="grid grid-cols-2 gap-3">
                                        <div className="space-y-2">
                                            <Label htmlFor="totp-period">
                                                Period (seconds)
                                            </Label>
                                            <Input
                                                id="totp-period"
                                                type="number"
                                                min={1}
                                                {...register("TOTP.Period", {
                                                    valueAsNumber: true,
                                                })}
                                            />
                                            {errors.TOTP?.Period && (
                                                <p className="text-xs text-destructive">
                                                    {errors.TOTP.Period.message}
                                                </p>
                                            )}
                                        </div>
                                        <div className="space-y-2">
                                            <Label htmlFor="totp-digits">
                                                Digits
                                            </Label>
                                            <Input
                                                id="totp-digits"
                                                type="number"
                                                min={1}
                                                {...register("TOTP.Digits", {
                                                    valueAsNumber: true,
                                                })}
                                            />
                                            {errors.TOTP?.Digits && (
                                                <p className="text-xs text-destructive">
                                                    {errors.TOTP.Digits.message}
                                                </p>
                                            )}
                                        </div>
                                    </div>
                                    <div className="space-y-2">
                                        <Label>Algorithm</Label>
                                        <Controller
                                            name="TOTP.Algorithm"
                                            control={control}
                                            render={({ field }) => (
                                                <Select
                                                    value={String(
                                                        field.value ??
                                                            TOTPConstants.ALGORITHM_DEFAULT,
                                                    )}
                                                    onValueChange={(value) =>
                                                        field.onChange(
                                                            Number(value),
                                                        )
                                                    }
                                                >
                                                    <SelectTrigger className="text-foreground">
                                                        <SelectValue placeholder="Select algorithm" />
                                                    </SelectTrigger>
                                                    <SelectContent>
                                                        <SelectItem
                                                            value={String(
                                                                TOTPAlgorithm.SHA1,
                                                            )}
                                                        >
                                                            SHA1
                                                        </SelectItem>
                                                        <SelectItem
                                                            value={String(
                                                                TOTPAlgorithm.SHA256,
                                                            )}
                                                        >
                                                            SHA256
                                                        </SelectItem>
                                                        <SelectItem
                                                            value={String(
                                                                TOTPAlgorithm.SHA512,
                                                            )}
                                                        >
                                                            SHA512
                                                        </SelectItem>
                                                    </SelectContent>
                                                </Select>
                                            )}
                                        />
                                        {errors.TOTP?.Algorithm && (
                                            <p className="text-xs text-destructive">
                                                {errors.TOTP.Algorithm.message}
                                            </p>
                                        )}
                                    </div>
                                </div>
                            )}

                            {/* Custom Fields */}
                            <Separator />
                            <div>
                                <div className="mb-4 flex items-center justify-between">
                                    <div>
                                        <Label className="text-sm font-medium">
                                            Custom Fields
                                        </Label>
                                        <p className="mt-0.5 text-xs text-muted-foreground">
                                            Add additional information
                                        </p>
                                    </div>
                                    <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        onClick={handleAddCustomField}
                                        className="gap-1.5"
                                    >
                                        <Plus className="h-3.5 w-3.5" />
                                        Add Field
                                    </Button>
                                </div>

                                {customFields.length > 0 && (
                                    <div className="space-y-3">
                                        {customFields.map((field, index) => {
                                            const fieldType = watch(
                                                `CustomFields.${index}.Type`,
                                            );
                                            const isRevealed =
                                                !!revealedCustomFieldIds[
                                                    field.id
                                                ];
                                            const isMasked =
                                                fieldType ===
                                                CustomFieldType.MaskedText;
                                            const valueInput = (
                                                <Textarea
                                                    placeholder="Value"
                                                    rows={1}
                                                    {...register(
                                                        `CustomFields.${index}.Value`,
                                                    )}
                                                    className={cn(
                                                        "h-8 min-h-8 resize-y py-1 font-mono text-sm",
                                                        isMasked
                                                            ? cn(
                                                                  plainFieldClassName,
                                                                  "w-full",
                                                                  !isRevealed &&
                                                                      "secret-masked",
                                                              )
                                                            : "min-w-0 flex-1",
                                                    )}
                                                />
                                            );
                                            return (
                                                <div
                                                    key={field.id}
                                                    className="flex items-start gap-2 rounded-lg border border-border bg-muted/50 p-3"
                                                >
                                                    <GripVertical className="mt-2.5 h-4 w-4 cursor-grab text-muted-foreground" />
                                                    <div className="flex-1 space-y-2">
                                                        <Input
                                                            placeholder="Field name"
                                                            {...register(
                                                                `CustomFields.${index}.Name`,
                                                            )}
                                                            className="h-8 text-sm"
                                                        />
                                                        <div className="flex items-start gap-2">
                                                            {fieldType ===
                                                            CustomFieldType.Boolean ? (
                                                                <Controller
                                                                    control={
                                                                        control
                                                                    }
                                                                    name={`CustomFields.${index}.Value`}
                                                                    render={({
                                                                        field: valueField,
                                                                    }) => (
                                                                        <div className="flex h-8 min-w-0 flex-1 items-center gap-2">
                                                                            <Switch
                                                                                checked={
                                                                                    valueField.value ===
                                                                                    "true"
                                                                                }
                                                                                onCheckedChange={(
                                                                                    checked,
                                                                                ) =>
                                                                                    valueField.onChange(
                                                                                        String(
                                                                                            checked,
                                                                                        ),
                                                                                    )
                                                                                }
                                                                                aria-label="Custom field value"
                                                                            />
                                                                            <span className="text-sm text-muted-foreground">
                                                                                {valueField.value ===
                                                                                "true"
                                                                                    ? "Yes"
                                                                                    : "No"}
                                                                            </span>
                                                                        </div>
                                                                    )}
                                                                />
                                                            ) : isMasked ? (
                                                                <ControlWithActions
                                                                    align="start"
                                                                    className="min-w-0 flex-1 items-center"
                                                                    actions={
                                                                        <div className="pr-0.5">
                                                                            <TooltipProvider>
                                                                                <Tooltip>
                                                                                    <TooltipTrigger
                                                                                        asChild
                                                                                    >
                                                                                        <Button
                                                                                            type="button"
                                                                                            variant="ghost"
                                                                                            size="icon"
                                                                                            className="h-7 w-7"
                                                                                            aria-label={
                                                                                                isRevealed
                                                                                                    ? "Hide value"
                                                                                                    : "Show value"
                                                                                            }
                                                                                            onClick={() =>
                                                                                                toggleCustomFieldReveal(
                                                                                                    field.id,
                                                                                                )
                                                                                            }
                                                                                        >
                                                                                            {isRevealed ? (
                                                                                                <EyeOff className="h-3.5 w-3.5" />
                                                                                            ) : (
                                                                                                <Eye className="h-3.5 w-3.5" />
                                                                                            )}
                                                                                        </Button>
                                                                                    </TooltipTrigger>
                                                                                    <TooltipContent>
                                                                                        {isRevealed
                                                                                            ? "Hide"
                                                                                            : "Show"}
                                                                                    </TooltipContent>
                                                                                </Tooltip>
                                                                            </TooltipProvider>
                                                                        </div>
                                                                    }
                                                                >
                                                                    {valueInput}
                                                                </ControlWithActions>
                                                            ) : (
                                                                valueInput
                                                            )}
                                                            <Controller
                                                                control={
                                                                    control
                                                                }
                                                                name={`CustomFields.${index}.Type`}
                                                                render={({
                                                                    field: typeField,
                                                                }) => (
                                                                    <Select
                                                                        value={String(
                                                                            typeField.value ??
                                                                                CustomFieldType.Text,
                                                                        )}
                                                                        onValueChange={(
                                                                            value,
                                                                        ) => {
                                                                            const nextType =
                                                                                Number(
                                                                                    value,
                                                                                );
                                                                            typeField.onChange(
                                                                                nextType,
                                                                            );
                                                                            if (
                                                                                nextType ===
                                                                                CustomFieldType.Boolean
                                                                            ) {
                                                                                setValue(
                                                                                    `CustomFields.${index}.Value`,
                                                                                    watch(
                                                                                        `CustomFields.${index}.Value`,
                                                                                    ) ===
                                                                                        "true"
                                                                                        ? "true"
                                                                                        : "false",
                                                                                    {
                                                                                        shouldDirty: true,
                                                                                    },
                                                                                );
                                                                            }
                                                                        }}
                                                                    >
                                                                        <SelectTrigger className="h-8 w-24">
                                                                            <SelectValue />
                                                                        </SelectTrigger>
                                                                        <SelectContent>
                                                                            <SelectItem
                                                                                value={String(
                                                                                    CustomFieldType.Text,
                                                                                )}
                                                                            >
                                                                                Text
                                                                            </SelectItem>
                                                                            <SelectItem
                                                                                value={String(
                                                                                    CustomFieldType.MaskedText,
                                                                                )}
                                                                            >
                                                                                Hidden
                                                                            </SelectItem>
                                                                            <SelectItem
                                                                                value={String(
                                                                                    CustomFieldType.Boolean,
                                                                                )}
                                                                            >
                                                                                Checkbox
                                                                            </SelectItem>
                                                                        </SelectContent>
                                                                    </Select>
                                                                )}
                                                            />
                                                        </div>
                                                    </div>
                                                    <Button
                                                        type="button"
                                                        variant="ghost"
                                                        size="icon"
                                                        onClick={() =>
                                                            remove(index)
                                                        }
                                                        className="h-8 w-8 text-muted-foreground hover:text-destructive"
                                                    >
                                                        <Trash2 className="h-3.5 w-3.5" />
                                                    </Button>
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}

                                {customFields.length === 0 && (
                                    <div className="rounded-lg border border-dashed border-border py-6 text-center">
                                        <FileText className="mx-auto mb-2 h-8 w-8 text-muted-foreground" />
                                        <p className="text-sm text-muted-foreground">
                                            No custom fields yet
                                        </p>
                                    </div>
                                )}
                            </div>
                        </div>
                    </ScrollArea>

                    <SheetFooter className="border-t border-border p-6 pt-4">
                        <div className="flex w-full items-center gap-3">
                            <Button
                                variant="outline"
                                onClick={requestClose}
                                disabled={isSubmitting}
                                className="flex-1"
                            >
                                Cancel
                            </Button>
                            <Button
                                onClick={handleSubmit(onSubmit)}
                                disabled={isSubmitting}
                                className="flex-1"
                            >
                                {isSubmitting ? (
                                    <>
                                        <Loader2 className="h-4 w-4 animate-spin" />
                                        Saving...
                                    </>
                                ) : isNew ? (
                                    "Create Credential"
                                ) : (
                                    "Save Changes"
                                )}
                            </Button>
                        </div>
                    </SheetFooter>
                </SheetContent>
            </Sheet>
            <WarningDialog showFnRef={showWarningDialogFnRef} />
            <PasswordGeneratorDialog
                open={isPasswordGeneratorOpen}
                onOpenChange={setIsPasswordGeneratorOpen}
                onPasswordSelect={handleGeneratedPasswordSelect}
            />
            <DirectoryEditorDialog
                open={directoryEditorOpen}
                onOpenChange={setDirectoryEditorOpen}
                directory={null}
                onCreate={async (name) => {
                    const directoryID = await onCreateDirectory(name);
                    if (typeof directoryID === "string" && directoryID) {
                        setValue("DirectoryID", directoryID, {
                            shouldDirty: true,
                            shouldValidate: true,
                        });
                    }
                    return directoryID;
                }}
            />
        </>
    );
}
