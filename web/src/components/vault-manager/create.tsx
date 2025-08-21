import { Controller, useForm } from "react-hook-form";
import {
    encryptionFormGroupSchema,
    EncryptionFormGroupSchemaType,
    newVaultFormSchema,
    NewVaultFormSchemaType,
} from "../../app_lib/vault-utils/form-schemas";
import { zodResolver } from "@hookform/resolvers/zod";
import { LoaderCircle, Lock } from "lucide-react";
import { Button } from "../ui/button";
import { Label } from "../ui/label";
import { FormInput } from "../general/input-fields";
import {
    Accordion,
    AccordionContent,
    AccordionItem,
    AccordionTrigger,
} from "../ui/accordion";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "../ui/select";
import { enumToRecord } from "@/utils/consts";
import {
    EncryptionAlgorithm,
    KeyDerivationFunction,
} from "@/app_lib/proto/vault";
import {
    KeyDerivationConfig_Argon2ID,
    KeyDerivationConfig_PBKDF2,
} from "@/app_lib/vault-utils/encryption";
import { Input } from "../ui/input";
import { Textarea } from "../ui/textarea";

const CreateVaultTab: React.FC<{
    executeCallback: (
        formData: NewVaultFormSchemaType & EncryptionFormGroupSchemaType,
    ) => Promise<boolean>;
}> = ({ executeCallback }) => {
    const {
        handleSubmit,
        control,
        register,
        setValue,
        formState: { errors, isSubmitting },
        watch,
    } = useForm<NewVaultFormSchemaType & EncryptionFormGroupSchemaType>({
        resolver: zodResolver(
            newVaultFormSchema.merge(encryptionFormGroupSchema),
        ),
        defaultValues: {
            Name: "",
            Description: "",
            Secret: "",
            Encryption: EncryptionAlgorithm.XChaCha20Poly1305,
            EncryptionKeyDerivationFunction: KeyDerivationFunction.Argon2ID,
            EncryptionConfig: {
                iterations: KeyDerivationConfig_PBKDF2.DEFAULT_ITERATIONS,
                memLimit: KeyDerivationConfig_Argon2ID.DEFAULT_MEM_LIMIT,
                opsLimit: KeyDerivationConfig_Argon2ID.DEFAULT_OPS_LIMIT,
            },
        },
    });

    const tryCreateVault = async (
        formData: NewVaultFormSchemaType & EncryptionFormGroupSchemaType,
    ) => {
        await executeCallback(formData);
    };

    return (
        <div className="space-y-4 pt-4">
            <div className="space-y-2">
                <Label htmlFor="new-vault-name">New Vault Name *</Label>
                <FormInput
                    id="new-vault-name"
                    type="text"
                    placeholder="Enter your new vault name"
                    className="pr-10"
                    {...register("Name")}
                />
                {errors.Name && (
                    <p className="text-destructive-foreground">
                        {errors.Name.message}
                    </p>
                )}
            </div>

            <div className="space-y-2">
                <Label htmlFor="new-vault-description">
                    New Vault Description
                </Label>
                <Textarea
                    id="new-vault-description"
                    placeholder="Enter a description for your new vault"
                    className="max-h-20 pr-10"
                    {...register("Description")}
                />
                {errors.Description && (
                    <p className="text-destructive-foreground">
                        {errors.Description.message}
                    </p>
                )}
            </div>

            <div className="space-y-2">
                <Label htmlFor="secret-key">Secret Key *</Label>
                <FormInput
                    id="secret-key"
                    type="password"
                    placeholder="Enter your secret key"
                    className="pr-10"
                    {...register("Secret")}
                    setValue={(value) => setValue("Secret", value)}
                    onKeyDown={(e) => {
                        if (e.key === "Enter") {
                            handleSubmit(tryCreateVault)();
                        }
                    }}
                />
                {errors.Secret && (
                    <p className="text-destructive-foreground">
                        {errors.Secret.message}
                    </p>
                )}
            </div>

            <div className="space-y-2">
                <Accordion
                    type="single"
                    collapsible
                    className="w-full rounded-md border"
                >
                    <AccordionItem value="encryption-config">
                        <AccordionTrigger className="px-4">
                            Encryption Configuration
                        </AccordionTrigger>
                        <AccordionContent className="space-y-4 px-4 pb-4">
                            <div className="space-y-2">
                                <Label htmlFor="encryption-algorithm">
                                    Encryption Algorithm
                                </Label>
                                <Controller
                                    name="Encryption"
                                    control={control}
                                    render={({ field }) => (
                                        <Select
                                            value={field.value.toString()}
                                            onValueChange={(value) => {
                                                field.onChange(Number(value));
                                            }}
                                        >
                                            <SelectTrigger id="encryption-algorithm">
                                                <SelectValue placeholder="Select algorithm" />
                                            </SelectTrigger>
                                            <SelectContent>
                                                {Object.entries(
                                                    enumToRecord(
                                                        EncryptionAlgorithm,
                                                    ),
                                                ).map(([value, label]) => (
                                                    <SelectItem
                                                        key={label}
                                                        value={String(value)}
                                                    >
                                                        {label}
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    )}
                                />
                                {errors.Encryption && (
                                    <p className="text-destructive-foreground">
                                        {errors.Encryption.message}
                                    </p>
                                )}
                            </div>

                            <div className="space-y-2">
                                <Label htmlFor="key-derivation-function">
                                    Key Derivation Function
                                </Label>
                                <Controller
                                    name="EncryptionKeyDerivationFunction"
                                    control={control}
                                    render={({ field }) => (
                                        <Select
                                            value={field.value.toString()}
                                            onValueChange={(value) => {
                                                field.onChange(Number(value));
                                            }}
                                        >
                                            <SelectTrigger id="key-derivation-function">
                                                <SelectValue placeholder="Select function" />
                                            </SelectTrigger>
                                            <SelectContent>
                                                {Object.entries(
                                                    enumToRecord(
                                                        KeyDerivationFunction,
                                                    ),
                                                ).map(([value, label]) => (
                                                    <SelectItem
                                                        key={label}
                                                        value={String(value)}
                                                    >
                                                        {label}
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    )}
                                />
                                {errors.EncryptionKeyDerivationFunction && (
                                    <p className="text-destructive-foreground">
                                        {
                                            errors
                                                .EncryptionKeyDerivationFunction
                                                .message
                                        }
                                    </p>
                                )}
                            </div>

                            {watch(
                                "EncryptionKeyDerivationFunction",
                            ).toString() ===
                                KeyDerivationFunction.Argon2ID.toString() && (
                                <>
                                    <div className="grid grid-cols-2 gap-4">
                                        <div className="space-y-2">
                                            <Label htmlFor="memory-limit">
                                                Memory Limit (MiB)
                                            </Label>
                                            <Input
                                                id="memory-limit"
                                                type="number"
                                                min={
                                                    KeyDerivationConfig_Argon2ID.MIN_MEM_LIMIT
                                                }
                                                {...register(
                                                    "EncryptionConfig.memLimit",
                                                )}
                                            />
                                        </div>
                                        <div className="space-y-2">
                                            <Label htmlFor="operations-limit">
                                                Operations Limit
                                            </Label>
                                            <Input
                                                id="operations-limit"
                                                type="number"
                                                min={
                                                    KeyDerivationConfig_Argon2ID.MIN_OPS_LIMIT
                                                }
                                                max={
                                                    KeyDerivationConfig_Argon2ID.MAX_OPS_LIMIT
                                                }
                                                {...register(
                                                    "EncryptionConfig.opsLimit",
                                                )}
                                            />
                                        </div>
                                    </div>
                                </>
                            )}

                            {watch(
                                "EncryptionKeyDerivationFunction",
                            ).toString() ===
                                KeyDerivationFunction.PBKDF2.toString() && (
                                <>
                                    <div className="grid grid-cols-2 gap-4">
                                        <div className="space-y-2">
                                            <Label htmlFor="memory-limit">
                                                Iterations
                                            </Label>
                                            <Input
                                                id="pkdf-iterations"
                                                type="number"
                                                min={2}
                                                {...register(
                                                    "EncryptionConfig.iterations",
                                                )}
                                            />
                                        </div>
                                    </div>
                                </>
                            )}
                            {errors.EncryptionConfig && (
                                <p className="text-destructive-foreground">
                                    {errors.EncryptionConfig.message}
                                </p>
                            )}

                            {/* <div className="space-y-2"> */}
                            {/*     <Label htmlFor="additional-config"> */}
                            {/*         Additional Configuration (JSON) */}
                            {/*     </Label> */}
                            {/*     <Textarea */}
                            {/*         id="additional-config" */}
                            {/*         value={decryptionConfig} */}
                            {/*         onChange={(e) => */}
                            {/*             setDecryptionConfig(e.target.value) */}
                            {/*         } */}
                            {/*         placeholder="Enter additional configuration as JSON" */}
                            {/*         rows={3} */}
                            {/*     /> */}
                            {/* </div> */}
                            {/* --------------------- */}
                        </AccordionContent>
                    </AccordionItem>
                </Accordion>
            </div>

            <Button
                className="w-full"
                variant="link"
                onClick={handleSubmit(tryCreateVault)}
                disabled={isSubmitting}
            >
                {isSubmitting ? (
                    <span className="flex items-center">
                        <LoaderCircle className="-ml-1 mr-2 h-4 w-4 animate-spin text-white" />
                        Creating Vault...
                    </span>
                ) : (
                    <span className="flex items-center">
                        <Lock className="mr-2 h-4 w-4" />
                        Create Vault
                    </span>
                )}
            </Button>
        </div>
    );
};

export default CreateVaultTab;
