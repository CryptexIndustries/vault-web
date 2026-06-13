import { useState, useEffect, useRef } from "react";
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
    Link,
    FileText,
    Globe,
    GripVertical,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
    createCredential,
    CredentialFormSchema,
    CredentialFormSchemaType,
    CustomField,
    updateCredentialFromForm,
    VaultCredential,
} from "@/app_lib/vault-utils/vault";
import {
    CustomFieldType,
    ItemType,
    TOTPAlgorithm,
} from "@/app_lib/proto/vault";
import { cn } from "@/lib/utils";
import { CredentialConstants, TOTPConstants } from "@/utils/consts";
import { PasswordGeneratorDialog } from "@/components/ui/password-generator";
import { PasswordStrengthMeter } from "@/components/vault-security/password-strength-meter";
import {
    WarningDialog,
    WarningDialogShowFn,
} from "@/components/dialog/warning";

interface EditDrawerProps {
    credential: VaultCredential | null;
    isOpen: boolean;
    onClose: () => void;
    onSave: (credential: VaultCredential) => void;
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
}: EditDrawerProps) {
    const isNew = !credential;

    const [showPassword, setShowPassword] = useState(false);
    const [isPasswordGeneratorOpen, setIsPasswordGeneratorOpen] =
        useState(false);

    const buildDefaultValues = (): CredentialFormSchemaType => ({
        ID: null,
        Type: ItemType.Credentials,
        GroupID: "",
        Name: "",
        Username: "",
        Password: "",
        TOTP: null,
        Tags: "",
        URL: "",
        Notes: "",
        CustomFields: [],
    });

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
    const showWarningDialogFnRef = useRef<WarningDialogShowFn | null>(null);

    useEffect(() => {
        if (credential) {
            reset({
                ID: credential.ID,
                Type: credential.Type,
                GroupID: credential.GroupID,
                Name: credential.Name,
                Username: credential.Username,
                Password: credential.Password,
                URL: credential.URL,
                Notes: credential.Notes,
                Tags: credential.Tags || "",
                TOTP: credential.TOTP ?? null,
                CustomFields: credential.CustomFields,
            });
        } else {
            reset(buildDefaultValues());
        }

        setShowPassword(false);
    }, [credential, isOpen, reset]);

    const handleAddCustomField = () => {
        append({
            ID: `custom-${Date.now()}`,
            Name: "",
            Type: CustomFieldType.Text,
            Value: "",
        });
    };

    const handleGeneratedPasswordSelect = (newPassword: string) => {
        setValue("Password", newPassword, {
            shouldDirty: true,
            shouldValidate: true,
        });
        setShowPassword(true);
    };

    const handleTotpToggle = (enabled: boolean) => {
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

        const savedCredential = credential
            ? await updateCredentialFromForm(credential, normalizedFormData)
            : await createCredential(normalizedFormData);

        onSave(savedCredential);
        onClose();
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
                            {isNew ? "Add New Credential" : "Edit Credential"}
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
                                    <div className="relative">
                                        <Key className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                                        <Input
                                            id="password"
                                            type={
                                                showPassword
                                                    ? "text"
                                                    : "password"
                                            }
                                            placeholder="Enter password"
                                            {...register("Password")}
                                            className={cn(
                                                "pl-10 pr-20 font-mono",
                                                errors.Password &&
                                                    "border-destructive",
                                            )}
                                        />
                                        <div className="absolute right-1 top-1/2 flex -translate-y-1/2 items-center gap-1">
                                            <TooltipProvider>
                                                <Tooltip>
                                                    <TooltipTrigger asChild>
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
                                                    <TooltipTrigger asChild>
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
                                                        >
                                                            <RefreshCw className="h-3.5 w-3.5" />
                                                        </Button>
                                                    </TooltipTrigger>
                                                    <TooltipContent>
                                                        Generate password
                                                    </TooltipContent>
                                                </Tooltip>
                                            </TooltipProvider>
                                        </div>
                                    </div>
                                    {errors.Password && (
                                        <p className="text-xs text-destructive">
                                            {errors.Password.message}
                                        </p>
                                    )}
                                    <PasswordStrengthMeter
                                        password={watchedPassword}
                                    />
                                </div>

                                <div className="space-y-2">
                                    <Label
                                        htmlFor="url"
                                        className="text-sm font-medium"
                                    >
                                        Website URL
                                    </Label>
                                    <div className="relative">
                                        <Link className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                                        <Input
                                            id="url"
                                            placeholder="https://example.com"
                                            {...register("URL")}
                                            className="pl-10"
                                        />
                                    </div>
                                </div>

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
                                    checked={!!watchedTotp}
                                    onCheckedChange={handleTotpToggle}
                                />
                            </div>
                            {watchedTotp && (
                                <div className="space-y-3 rounded-lg border p-3">
                                    <div className="space-y-2">
                                        <Label htmlFor="totp-label">
                                            TOTP Label
                                        </Label>
                                        <Input
                                            id="totp-label"
                                            placeholder="Credential"
                                            {...register("TOTP.Label")}
                                        />
                                        {errors.TOTP?.Label && (
                                            <p className="text-xs text-destructive">
                                                {errors.TOTP.Label.message}
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
                                            const fieldValue = watch(
                                                `CustomFields.${index}.Value`,
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
                                                        <div className="flex items-center gap-2">
                                                            <Input
                                                                placeholder="Value"
                                                                type={
                                                                    fieldType ===
                                                                    CustomFieldType.MaskedText
                                                                        ? "password"
                                                                        : "text"
                                                                }
                                                                {...register(
                                                                    `CustomFields.${index}.Value`,
                                                                )}
                                                                className="h-8 font-mono text-sm"
                                                            />
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
                                                                        ) =>
                                                                            typeField.onChange(
                                                                                Number(
                                                                                    value,
                                                                                ),
                                                                            )
                                                                        }
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
                                                                        </SelectContent>
                                                                    </Select>
                                                                )}
                                                            />
                                                        </div>
                                                        {fieldType ===
                                                            CustomFieldType.MaskedText &&
                                                        fieldValue.length >
                                                            0 ? (
                                                            <PasswordStrengthMeter
                                                                password={
                                                                    fieldValue
                                                                }
                                                            />
                                                        ) : null}
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
        </>
    );
}
