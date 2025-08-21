import { zodResolver } from "@hookform/resolvers/zod";
import { wordlist as englishWordlist } from "@scure/bip39/wordlists/english";
import {
    Brain,
    Copy,
    Hash,
    RefreshCw,
    Shield,
} from "lucide-react";
import * as React from "react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "react-toastify";
import * as z from "zod";
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

// Schema for form validation
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

export const PasswordGeneratorDialog: React.FC<{
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onPasswordSelect?: (password: string) => void;
}> = ({
    open,
    onOpenChange,
    onPasswordSelect,
}) => {
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

    // Generate random password
    const generateRandomPassword = (data: PasswordGeneratorFormData) => {
        const { length, includeUppercase, includeLowercase, includeNumbers, includeSymbols } = data;

        let charset = "";
        if (includeLowercase) charset += "abcdefghijklmnopqrstuvwxyz";
        if (includeUppercase) charset += "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
        if (includeNumbers) charset += "0123456789";
        if (includeSymbols) charset += "!@#$%^&*()_+-=[]{}|;:,.<>?";

        if (charset.length === 0) {
            toast.error("Please select at least one character type");
            return "";
        }

        let password = "";
        const array = new Uint8Array(length);
        crypto.getRandomValues(array);

        array.forEach((element, index) => {
            password += charset.charAt(element % charset.length);
        });

        return password;
    };

    // Generate memorable passphrase
    const generateMemorablePassphrase = (data: PasswordGeneratorFormData) => {
        const { length, includeUppercase, includeNumbers, wordSeparator } = data;

        const words: string[] = [];
        const wordlist = englishWordlist;

        for (let i = 0; i < length; i++) {
            const randValue = crypto.getRandomValues(new Uint32Array(1))[0];

            // If the random value is 0, skip the iteration
            if (!randValue) {
                continue;
            }

            const randomIndex = randValue % wordlist.length;

            let word = wordlist[randomIndex];

            if (!word)
                continue;

            if (includeUppercase && Math.random() > 0.5) {
                word = word.charAt(0).toUpperCase() + word.slice(1);
            }

            if (includeNumbers && Math.random() > 0.7) {
                const randomDigitValue = crypto.getRandomValues(new Uint32Array(1))[0];

                if (!randomDigitValue)
                    continue;

                const randomDigit = randomDigitValue % 10;
                word += randomDigit.toString();
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
    };

    // Generate password based on form data
    const generatePassword = (data: PasswordGeneratorFormData) => {
        let password = "";

        if (data.type === "random") {
            password = generateRandomPassword(data);
        } else {
            password = generateMemorablePassphrase(data);
        }

        setGeneratedPassword(password);
        return password;
    };

    // Handle form submission
    const onSubmit = (data: PasswordGeneratorFormData) => {
        if (generatedPassword && onPasswordSelect) {
            onPasswordSelect(generatedPassword);
            onOpenChange(false);
            toast.success("Password generated and applied!");
        }
    };

    // Copy password to clipboard
    const copyToClipboard = async () => {
        if (!generatedPassword) return;
        await navigator.clipboard.writeText(generatedPassword);
        toast.success("Password copied to clipboard!");
    };

    // Regenerate password
    const regeneratePassword = () => {
        const formData = watch();
        generatePassword(formData);
    };

    // Generate initial password on dialog open
    React.useEffect(() => {
        if (open) {
            const formData = watch();
            generatePassword(formData);
        }
    }, [open]);

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[500px]">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <Shield className="h-5 w-5 text-primary" />
                        Password Generator
                    </DialogTitle>
                    <DialogDescription>
                        Generate a secure password or memorable passphrase
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-4">
                    {/* Generated Password Display */}
                    <div className="space-y-2">
                        <Label>Generated Password</Label>
                        <div className="relative">
                            <Textarea
                                value={generatedPassword}
                                readOnly
                                className="min-h-[80px] resize-none font-mono text-sm px-3 py-3 pr-14"
                                placeholder="Click generate to create a password"
                            />
                            <div className="absolute right-5 top-2 flex gap-1">
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    onClick={copyToClipboard}
                                    disabled={!generatedPassword}
                                    className="h-6 w-6"
                                >
                                    <Copy className="h-3 w-3" />
                                </Button>
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    onClick={regeneratePassword}
                                    className="h-6 w-6"
                                >
                                    <RefreshCw className="h-3 w-3" />
                                </Button>
                            </div>
                        </div>
                    </div>

                    {/* Generation Type */}
                    <div className="space-y-2">
                        <Label>Generation Type</Label>
                        <Select
                            value={watch("type")}
                            onValueChange={(value) => setValue("type", value as "random" | "memorable")}
                        >
                            <SelectTrigger>
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

                    {/* Password Length */}
                    <div className="space-y-2">
                        <Label>Length</Label>
                        <div className="flex items-center gap-2">
                            <Input
                                type="number"
                                min="4"
                                max="128"
                                {...register("length", { valueAsNumber: true })}
                                className="flex-1"
                            />
                            <span className="text-sm text-muted-foreground">
                                {watchedType === "random" ? "characters" : "words"}
                            </span>
                        </div>
                        {errors.length && (
                            <p className="text-sm text-destructive">{errors.length.message}</p>
                        )}
                    </div>

                    {/* Advanced Options */}
                    <Accordion type="single" collapsible>
                        <AccordionItem value="advanced">
                            <AccordionTrigger className="text-sm">Advanced Options</AccordionTrigger>
                            <AccordionContent className="space-y-4">
                                {watchedType === "random" && (
                                    <div className="space-y-3">
                                        <div className="flex items-center space-x-2">
                                            <input
                                                type="checkbox"
                                                id="includeUppercase"
                                                {...register("includeUppercase")}
                                                className="h-4 w-4 rounded border-gray-300"
                                            />
                                            <Label htmlFor="includeUppercase" className="text-sm">
                                                Include uppercase letters (A-Z)
                                            </Label>
                                        </div>
                                        <div className="flex items-center space-x-2">
                                            <input
                                                type="checkbox"
                                                id="includeLowercase"
                                                {...register("includeLowercase")}
                                                className="h-4 w-4 rounded border-gray-300"
                                            />
                                            <Label htmlFor="includeLowercase" className="text-sm">
                                                Include lowercase letters (a-z)
                                            </Label>
                                        </div>
                                        <div className="flex items-center space-x-2">
                                            <input
                                                type="checkbox"
                                                id="includeNumbers"
                                                {...register("includeNumbers")}
                                                className="h-4 w-4 rounded border-gray-300"
                                            />
                                            <Label htmlFor="includeNumbers" className="text-sm">
                                                Include numbers (0-9)
                                            </Label>
                                        </div>
                                        <div className="flex items-center space-x-2">
                                            <input
                                                type="checkbox"
                                                id="includeSymbols"
                                                {...register("includeSymbols")}
                                                className="h-4 w-4 rounded border-gray-300"
                                            />
                                            <Label htmlFor="includeSymbols" className="text-sm">
                                                Include symbols (!@#$%^&*)
                                            </Label>
                                        </div>
                                    </div>
                                )}

                                {watchedType === "memorable" && (
                                    <div className="space-y-3">
                                        <div className="space-y-2">
                                            <Label className="text-sm">Word Separator</Label>
                                            <Select
                                                value={watch("wordSeparator")}
                                                onValueChange={(value) => setValue("wordSeparator", value as "space" | "dash" | "underscore" | "none")}
                                            >
                                                <SelectTrigger>
                                                    <SelectValue />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    <SelectItem value="space">Space (word1 word2)</SelectItem>
                                                    <SelectItem value="dash">Dash (word1-word2)</SelectItem>
                                                    <SelectItem value="underscore">Underscore (word1_word2)</SelectItem>
                                                    <SelectItem value="none">None (word1word2)</SelectItem>
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
                                            <Label htmlFor="memorableUppercase" className="text-sm">
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
                                            <Label htmlFor="memorableNumbers" className="text-sm">
                                                Include numbers
                                            </Label>
                                        </div>
                                    </div>
                                )}
                            </AccordionContent>
                        </AccordionItem>
                    </Accordion>
                </div>

                <DialogFooter className="gap-2">
                    <Button
                        type="button"
                        variant="outline"
                        onClick={() => onOpenChange(false)}
                    >
                        Cancel
                    </Button>
                    <Button
                        type="button"
                        variant="ghost"
                        onClick={copyToClipboard}
                        disabled={!generatedPassword}
                    >
                        <Copy className="h-4 w-4" />
                        Copy
                    </Button>
                    {
                        onPasswordSelect && (
                            <Button
                        type="button"
                        onClick={handleSubmit(onSubmit)}
                        disabled={!generatedPassword}
                    >
                            Use Password
                            </Button>
                        )
                    }
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}