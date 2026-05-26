import { zodResolver } from "@hookform/resolvers/zod";
import { wordlist as englishWordlist } from "@scure/bip39/wordlists/english";
import { Brain, Copy, Hash, RefreshCw, Shield, X } from "lucide-react";
import * as React from "react";
import { useCallback, useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import * as z from "zod";
import { cn } from "@/lib/utils";
import {
    Accordion,
    AccordionContent,
    AccordionItem,
    AccordionTrigger,
} from "./accordion";
import { Button } from "./button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "./dialog";
import { Input } from "./input";
import { Label } from "./label";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "./select";
import { Textarea } from "./textarea";

const passwordGeneratorSchema = z.object({
    type: z.enum(["random", "memorable"]),
    length: z.number().min(4).max(128),
    includeUppercase: z.boolean(),
    includeLowercase: z.boolean(),
    includeNumbers: z.boolean(),
    includeSymbols: z.boolean(),
    wordSeparator: z.enum(["space", "dash", "underscore", "none"]),
});

type PasswordGeneratorFormData = z.infer<typeof passwordGeneratorSchema>;

function generateRandomPassword(data: PasswordGeneratorFormData): string {
    const {
        length,
        includeUppercase,
        includeLowercase,
        includeNumbers,
        includeSymbols,
    } = data;

    let charset = "";
    if (includeLowercase) charset += "abcdefghijklmnopqrstuvwxyz";
    if (includeUppercase) charset += "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    if (includeNumbers) charset += "0123456789";
    if (includeSymbols) charset += "!@#$%^&*()_+-=[]{}|;:,.<>?";

    if (charset.length === 0) return "";

    let password = "";
    const array = new Uint8Array(length);
    crypto.getRandomValues(array);

    array.forEach((element) => {
        password += charset.charAt(element % charset.length);
    });

    return password;
}

function generateMemorablePassphrase(data: PasswordGeneratorFormData): string {
    const { length, includeUppercase, includeNumbers, wordSeparator } = data;

    const words: string[] = [];
    const wordlist = englishWordlist;

    for (let i = 0; i < length; i++) {
        const randValue = crypto.getRandomValues(new Uint32Array(1))[0];
        if (!randValue) continue;

        const randomIndex = randValue % wordlist.length;
        let word = wordlist[randomIndex];
        if (!word) continue;

        if (includeUppercase && Math.random() > 0.5) {
            word = word.charAt(0).toUpperCase() + word.slice(1);
        }

        if (includeNumbers && Math.random() > 0.7) {
            const randomDigitValue = crypto.getRandomValues(
                new Uint32Array(1),
            )[0];
            if (!randomDigitValue) continue;
            word += (randomDigitValue % 10).toString();
        }

        words.push(word);
    }

    let separator = "";
    switch (wordSeparator) {
        case "space":
            separator = " ";
            break;
        case "dash":
            separator = "-";
            break;
        case "underscore":
            separator = "_";
            break;
        case "none":
            separator = "";
            break;
    }

    return words.join(separator);
}

function generatePasswordFromForm(data: PasswordGeneratorFormData): string {
    if (data.type === "random") {
        return generateRandomPassword(data);
    }
    return generateMemorablePassphrase(data);
}

function usePasswordGenerator(showToasts: boolean) {
    const [generatedPassword, setGeneratedPassword] = useState("");

    const {
        register,
        handleSubmit,
        watch,
        setValue,
        formState: { errors },
    } = useForm<PasswordGeneratorFormData>({
        resolver: zodResolver(passwordGeneratorSchema),
        defaultValues: {
            type: "random",
            length: 16,
            includeUppercase: true,
            includeLowercase: true,
            includeNumbers: true,
            includeSymbols: false,
            wordSeparator: "space",
        },
    });

    const watchedType = watch("type");

    const notifyError = useCallback(
        (message: string) => {
            if (showToasts) toast.error(message);
        },
        [showToasts],
    );

    const notifySuccess = useCallback(
        (message: string) => {
            if (showToasts) toast.success(message);
        },
        [showToasts],
    );

    const generatePassword = useCallback(
        (data: PasswordGeneratorFormData) => {
            if (
                data.type === "random" &&
                !data.includeUppercase &&
                !data.includeLowercase &&
                !data.includeNumbers &&
                !data.includeSymbols
            ) {
                notifyError("Please select at least one character type");
                return "";
            }

            const password = generatePasswordFromForm(data);
            setGeneratedPassword(password);
            return password;
        },
        [notifyError],
    );

    const regeneratePassword = useCallback(() => {
        generatePassword(watch());
    }, [generatePassword, watch]);

    const copyToClipboard = useCallback(async () => {
        if (!generatedPassword) return;
        await navigator.clipboard.writeText(generatedPassword);
        notifySuccess("Password copied to clipboard!");
    }, [generatedPassword, notifySuccess]);

    useEffect(() => {
        generatePassword(watch());
        // Generate once when the panel mounts (dialog open or autofill iframe).
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    return {
        generatedPassword,
        register,
        handleSubmit,
        watch,
        setValue,
        errors,
        watchedType,
        regeneratePassword,
        copyToClipboard,
        generatePassword,
        notifySuccess,
    };
}

export type PasswordGeneratorPanelProps = {
    onPasswordSelect?: (password: string) => void;
    onCancel?: () => void;
    showToasts?: boolean;
    compact?: boolean;
    className?: string;
};

export const PasswordGeneratorPanel: React.FC<PasswordGeneratorPanelProps> = ({
    onPasswordSelect,
    onCancel,
    showToasts = false,
    compact = false,
    className,
}) => {
    const {
        generatedPassword,
        register,
        handleSubmit,
        watch,
        setValue,
        errors,
        watchedType,
        regeneratePassword,
        copyToClipboard,
        notifySuccess,
    } = usePasswordGenerator(showToasts);

    const onSubmit = (data: PasswordGeneratorFormData) => {
        if (generatedPassword && onPasswordSelect) {
            onPasswordSelect(generatedPassword);
            onCancel?.();
            notifySuccess("Password generated and applied!");
        } else if (!generatedPassword) {
            void data;
        }
    };

    const header = compact ? (
        <header className="flex shrink-0 items-center gap-2 border-b px-3 py-2">
            <span className="rounded-md bg-primary/15 p-1 text-primary">
                <Shield className="h-3.5 w-3.5" />
            </span>
            <div className="min-w-0 flex-1">
                <h1 className="truncate text-xs font-semibold">
                    Password Generator
                </h1>
            </div>
            {onCancel ? (
                <button
                    type="button"
                    onClick={onCancel}
                    className="rounded p-1 text-muted-foreground hover:text-foreground"
                    aria-label="Close generator"
                >
                    <X className="h-3.5 w-3.5" />
                </button>
            ) : null}
        </header>
    ) : (
        <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
                <Shield className="h-5 w-5 text-primary" />
                Password Generator
            </DialogTitle>
            <DialogDescription>
                Generate a secure password or memorable passphrase
            </DialogDescription>
        </DialogHeader>
    );

    const footer = compact ? (
        <footer className="flex shrink-0 gap-1.5 border-t px-3 py-2">
            {onCancel ? (
                <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 flex-1 text-xs"
                    onClick={onCancel}
                >
                    Cancel
                </Button>
            ) : null}
            <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 px-2"
                onClick={() => void copyToClipboard()}
                disabled={!generatedPassword}
            >
                <Copy className="h-3.5 w-3.5" />
            </Button>
            {onPasswordSelect ? (
                <Button
                    type="button"
                    size="sm"
                    className="h-7 flex-1 text-xs"
                    onClick={handleSubmit(onSubmit)}
                    disabled={!generatedPassword}
                >
                    Use password
                </Button>
            ) : null}
        </footer>
    ) : (
        <DialogFooter className="gap-2">
            {onCancel ? (
                <Button type="button" variant="outline" onClick={onCancel}>
                    Cancel
                </Button>
            ) : null}
            <Button
                type="button"
                variant="ghost"
                onClick={() => void copyToClipboard()}
                disabled={!generatedPassword}
            >
                <Copy className="h-4 w-4" />
                Copy
            </Button>
            {onPasswordSelect ? (
                <Button
                    type="button"
                    onClick={handleSubmit(onSubmit)}
                    disabled={!generatedPassword}
                >
                    Use Password
                </Button>
            ) : null}
        </DialogFooter>
    );

    return (
        <div
            className={cn(
                compact
                    ? "flex h-full max-h-full flex-col overflow-hidden"
                    : "space-y-4",
                className,
            )}
        >
            {header}
            <div
                className={cn(
                    compact
                        ? "min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-2"
                        : "space-y-4",
                )}
            >
                <div className={compact ? "space-y-1.5" : "space-y-2"}>
                    <Label className={compact ? "text-xs" : undefined}>
                        Generated Password
                    </Label>
                    <div className="relative">
                        <Textarea
                            value={generatedPassword}
                            readOnly
                            className={cn(
                                "resize-none font-mono",
                                compact
                                    ? "min-h-[56px] px-2 py-2 pr-12 text-[11px]"
                                    : "min-h-[80px] px-3 py-3 pr-14 text-sm",
                            )}
                            placeholder="Click generate to create a password"
                        />
                        <div
                            className={cn(
                                "absolute flex gap-1",
                                compact ? "right-2 top-1.5" : "right-5 top-2",
                            )}
                        >
                            <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                onClick={() => void copyToClipboard()}
                                disabled={!generatedPassword}
                                className={compact ? "h-5 w-5" : "h-6 w-6"}
                            >
                                <Copy
                                    className={
                                        compact ? "h-2.5 w-2.5" : "h-3 w-3"
                                    }
                                />
                            </Button>
                            <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                onClick={regeneratePassword}
                                className={compact ? "h-5 w-5" : "h-6 w-6"}
                            >
                                <RefreshCw
                                    className={
                                        compact ? "h-2.5 w-2.5" : "h-3 w-3"
                                    }
                                />
                            </Button>
                        </div>
                    </div>
                </div>

                <div className={compact ? "space-y-1.5" : "space-y-2"}>
                    <Label className={compact ? "text-xs" : undefined}>
                        Generation Type
                    </Label>
                    <Select
                        value={watch("type")}
                        onValueChange={(value) =>
                            setValue("type", value as "random" | "memorable")
                        }
                    >
                        <SelectTrigger
                            className={compact ? "h-8 text-xs" : undefined}
                        >
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="random">
                                <div className="flex items-center gap-2">
                                    <Hash className="h-4 w-4" />
                                    Random Password
                                </div>
                            </SelectItem>
                            <SelectItem value="memorable">
                                <div className="flex items-center gap-2">
                                    <Brain className="h-4 w-4" />
                                    Memorable Passphrase
                                </div>
                            </SelectItem>
                        </SelectContent>
                    </Select>
                </div>

                <div className={compact ? "space-y-1.5" : "space-y-2"}>
                    <Label className={compact ? "text-xs" : undefined}>
                        Length
                    </Label>
                    <div className="flex items-center gap-2">
                        <Input
                            type="number"
                            min="4"
                            max="128"
                            {...register("length", { valueAsNumber: true })}
                            className={cn("flex-1", compact && "h-8 text-xs")}
                        />
                        <span
                            className={cn(
                                "text-muted-foreground",
                                compact ? "text-[10px]" : "text-sm",
                            )}
                        >
                            {watchedType === "random" ? "characters" : "words"}
                        </span>
                    </div>
                    {errors.length ? (
                        <p
                            className={cn(
                                "text-destructive",
                                compact ? "text-[10px]" : "text-sm",
                            )}
                        >
                            {errors.length.message}
                        </p>
                    ) : null}
                </div>

                <Accordion type="single" collapsible>
                    <AccordionItem value="advanced">
                        <AccordionTrigger
                            className={compact ? "py-2 text-xs" : "text-sm"}
                        >
                            Advanced Options
                        </AccordionTrigger>
                        <AccordionContent
                            className={compact ? "space-y-2" : "space-y-4"}
                        >
                            {watchedType === "random" ? (
                                <div className="space-y-2">
                                    {(
                                        [
                                            [
                                                "includeUppercase",
                                                "Include uppercase letters (A-Z)",
                                            ],
                                            [
                                                "includeLowercase",
                                                "Include lowercase letters (a-z)",
                                            ],
                                            [
                                                "includeNumbers",
                                                "Include numbers (0-9)",
                                            ],
                                            [
                                                "includeSymbols",
                                                "Include symbols (!@#$%^&*)",
                                            ],
                                        ] as const
                                    ).map(([id, label]) => (
                                        <div
                                            key={id}
                                            className="flex items-center space-x-2"
                                        >
                                            <input
                                                type="checkbox"
                                                id={id}
                                                {...register(id)}
                                                className="h-4 w-4 rounded border-gray-300"
                                            />
                                            <Label
                                                htmlFor={id}
                                                className={
                                                    compact
                                                        ? "text-xs"
                                                        : "text-sm"
                                                }
                                            >
                                                {label}
                                            </Label>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <div className="space-y-2">
                                    <div className="space-y-2">
                                        <Label
                                            className={
                                                compact ? "text-xs" : "text-sm"
                                            }
                                        >
                                            Word Separator
                                        </Label>
                                        <Select
                                            value={watch("wordSeparator")}
                                            onValueChange={(value) =>
                                                setValue(
                                                    "wordSeparator",
                                                    value as
                                                        | "space"
                                                        | "dash"
                                                        | "underscore"
                                                        | "none",
                                                )
                                            }
                                        >
                                            <SelectTrigger
                                                className={
                                                    compact
                                                        ? "h-8 text-xs"
                                                        : undefined
                                                }
                                            >
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="space">
                                                    Space (word1 word2)
                                                </SelectItem>
                                                <SelectItem value="dash">
                                                    Dash (word1-word2)
                                                </SelectItem>
                                                <SelectItem value="underscore">
                                                    Underscore (word1_word2)
                                                </SelectItem>
                                                <SelectItem value="none">
                                                    None (word1word2)
                                                </SelectItem>
                                            </SelectContent>
                                        </Select>
                                    </div>
                                    <div className="flex items-center space-x-2">
                                        <input
                                            type="checkbox"
                                            id="memorableUppercase"
                                            {...register("includeUppercase")}
                                            className="h-4 w-4 rounded border-gray-300"
                                        />
                                        <Label
                                            htmlFor="memorableUppercase"
                                            className={
                                                compact ? "text-xs" : "text-sm"
                                            }
                                        >
                                            Include uppercase letters
                                        </Label>
                                    </div>
                                    <div className="flex items-center space-x-2">
                                        <input
                                            type="checkbox"
                                            id="memorableNumbers"
                                            {...register("includeNumbers")}
                                            className="h-4 w-4 rounded border-gray-300"
                                        />
                                        <Label
                                            htmlFor="memorableNumbers"
                                            className={
                                                compact ? "text-xs" : "text-sm"
                                            }
                                        >
                                            Include numbers
                                        </Label>
                                    </div>
                                </div>
                            )}
                        </AccordionContent>
                    </AccordionItem>
                </Accordion>
            </div>
            {footer}
        </div>
    );
};

export const PasswordGeneratorDialog: React.FC<{
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onPasswordSelect?: (password: string) => void;
}> = ({ open, onOpenChange, onPasswordSelect }) => {
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[500px]">
                {open ? (
                    <PasswordGeneratorPanel
                        showToasts
                        onPasswordSelect={onPasswordSelect}
                        onCancel={() => onOpenChange(false)}
                    />
                ) : null}
            </DialogContent>
        </Dialog>
    );
};
