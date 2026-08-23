import {
    CredentialURLMatchMode,
    type CredentialURL,
} from "@cryptex-industries/vault-core/proto";
import type { CredentialFormSchemaType } from "@cryptex-industries/vault-core/vault-utils/vault";
import { Link, Plus, Trash2 } from "lucide-react";
import {
    Controller,
    useFieldArray,
    type Control,
    type FieldErrors,
    type UseFormRegister,
} from "react-hook-form";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";

const MODE_LABELS: Record<CredentialURLMatchMode, string> = {
    [CredentialURLMatchMode.ExactHost]: "Exact host",
    [CredentialURLMatchMode.Domain]: "Parent and sibling domains",
    [CredentialURLMatchMode.Wildcard]: "Wildcard",
};

const MODE_HELP: Record<CredentialURLMatchMode, string> = {
    [CredentialURLMatchMode.ExactHost]: "Matches this hostname on any path.",
    [CredentialURLMatchMode.Domain]:
        "Matches every host on the same registrable domain. Use only when those hosts share one account boundary.",
    [CredentialURLMatchMode.Wildcard]:
        "Use * for one hostname label. In paths, * stays within one segment and ** crosses segments. The registrable domain cannot contain a wildcard.",
};

type URLRulesEditorProps = {
    control: Control<CredentialFormSchemaType>;
    errors: FieldErrors<CredentialFormSchemaType>;
    register: UseFormRegister<CredentialFormSchemaType>;
};

function ModeSelect({
    value,
    onChange,
}: {
    value: CredentialURLMatchMode;
    onChange: (value: CredentialURLMatchMode) => void;
}) {
    return (
        <Select
            value={String(value)}
            onValueChange={(next) =>
                onChange(Number(next) as CredentialURLMatchMode)
            }
        >
            <SelectTrigger className="w-full sm:w-[250px]">
                <SelectValue />
            </SelectTrigger>
            <SelectContent>
                {Object.entries(MODE_LABELS).map(([mode, label]) => (
                    <SelectItem key={mode} value={mode}>
                        {label}
                    </SelectItem>
                ))}
            </SelectContent>
        </Select>
    );
}

export function CredentialURLRulesEditor({
    control,
    errors,
    register,
}: URLRulesEditorProps) {
    const { fields, append, remove } = useFieldArray({
        control,
        name: "AdditionalURLs",
    });

    return (
        <div className="space-y-3">
            <div>
                <Label className="text-sm font-medium">Websites</Label>
                <p className="mt-1 text-xs text-muted-foreground">
                    Each rule controls where this credential may be offered.
                </p>
            </div>

            <div className="space-y-1.5 rounded-md border border-border p-3">
                <Label htmlFor="credential-primary-url" className="text-xs">
                    Primary website
                </Label>
                <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_250px]">
                    <div className="relative">
                        <Link className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                        <Input
                            id="credential-primary-url"
                            placeholder="https://example.com"
                            {...register("URL")}
                            className="pl-10"
                        />
                    </div>
                    <Controller
                        control={control}
                        name="URLMatchMode"
                        render={({ field }) => (
                            <ModeSelect
                                value={field.value}
                                onChange={field.onChange}
                            />
                        )}
                    />
                </div>
                {errors.URL?.message && (
                    <p className="text-xs text-destructive">
                        {errors.URL.message}
                    </p>
                )}
                <Controller
                    control={control}
                    name="URLMatchMode"
                    render={({ field }) => (
                        <p className="text-xs text-muted-foreground">
                            {MODE_HELP[field.value]}
                        </p>
                    )}
                />
            </div>

            {fields.map((urlField, index) => {
                const fieldError = errors.AdditionalURLs?.[index]?.URL;
                return (
                    <div
                        key={urlField.id}
                        className="space-y-1.5 rounded-md border border-border p-3"
                    >
                        <div className="flex items-center justify-between gap-2">
                            <Label
                                htmlFor={`credential-additional-url-${index}`}
                                className="text-xs"
                            >
                                Additional website {index + 1}
                            </Label>
                            <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 text-muted-foreground hover:text-destructive"
                                onClick={() => remove(index)}
                                aria-label={`Remove additional website ${index + 1}`}
                            >
                                <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                        </div>
                        <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_250px]">
                            <Input
                                id={`credential-additional-url-${index}`}
                                placeholder="https://app.example.com"
                                {...register(`AdditionalURLs.${index}.URL`)}
                            />
                            <Controller
                                control={control}
                                name={`AdditionalURLs.${index}.MatchMode`}
                                render={({ field }) => (
                                    <ModeSelect
                                        value={field.value}
                                        onChange={field.onChange}
                                    />
                                )}
                            />
                        </div>
                        {fieldError?.message && (
                            <p className="text-xs text-destructive">
                                {fieldError.message}
                            </p>
                        )}
                        <Controller
                            control={control}
                            name={`AdditionalURLs.${index}.MatchMode`}
                            render={({ field }) => (
                                <p className="text-xs text-muted-foreground">
                                    {MODE_HELP[field.value]}
                                </p>
                            )}
                        />
                    </div>
                );
            })}

            <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                    append({
                        URL: "",
                        MatchMode: CredentialURLMatchMode.ExactHost,
                    } satisfies CredentialURL)
                }
            >
                <Plus className="mr-2 h-4 w-4" />
                Add website rule
            </Button>
        </div>
    );
}
