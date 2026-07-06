import { useForm } from "react-hook-form";
import {
    encryptionFormGroupSchema,
    EncryptionFormGroupSchemaType,
    newVaultFormSchema,
    NewVaultFormSchemaType,
} from "../../app_lib/vault-utils/form-schemas";
import { zodResolver } from "@hookform/resolvers/zod";
import { FileUp, LoaderCircle, Lock, X } from "lucide-react";
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
    EncryptionAlgorithm,
    KeyDerivationFunction,
} from "@/app_lib/proto/vault";
import {
    KeyDerivationConfig_Argon2ID,
    KeyDerivationConfig_PBKDF2,
} from "@/app_lib/vault-utils/encryption";
import { Input } from "../ui/input";
import { Textarea } from "../ui/textarea";
import {
    SecondFactorOptions,
    type SecondFactorChoice,
    choiceToSource,
} from "./second-factor-options";
import type {
    VaultCreateSecondFactorOptions,
    VaultPendingUnlock,
    VaultRevealSecrets,
} from "@/app_lib/vault-utils/vault-unlock-types";
import { useEffect, useState } from "react";
import { PasswordStrengthMeter } from "@/components/vault-security/password-strength-meter";
import { KdfBelowRecommendedAck } from "@/components/vault-security/kdf-below-recommended-ack";
import { isBelowOwaspRecommendedArgon2id } from "@/app_lib/vault-utils/password-strength";
import { ImportWizard } from "@/components/vault-import/import-wizard";
import type { ImportResult } from "@/app_lib/vault-utils/import-export";

const CreateVaultTab: React.FC<{
    executeCallback: (
        formData: NewVaultFormSchemaType & EncryptionFormGroupSchemaType,
        secondFactorOptions?: VaultCreateSecondFactorOptions,
        initialImport?: ImportResult,
    ) => Promise<
        | false
        | {
              ok: true;
              revealSecrets: VaultRevealSecrets;
              pendingUnlock: VaultPendingUnlock;
          }
    >;
}> = ({ executeCallback }) => {
    const [secondFactorChoice, setSecondFactorChoice] =
        useState<SecondFactorChoice>("none");
    const [secondFactorSource, setSecondFactorSource] = useState(
        choiceToSource("none"),
    );
    const [kdfRiskAcknowledged, setKdfRiskAcknowledged] = useState(false);
    const [isImportWizardOpen, setIsImportWizardOpen] = useState(false);
    const [initialImport, setInitialImport] = useState<ImportResult | null>(
        null,
    );
    const {
        handleSubmit,
        register,
        setValue,
        watch,
        formState: { errors, isSubmitting },
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

    const secret = watch("Secret");
    const memLimit = watch("EncryptionConfig.memLimit");
    const opsLimit = watch("EncryptionConfig.opsLimit");

    useEffect(() => {
        setKdfRiskAcknowledged(false);
    }, [memLimit, opsLimit]);

    const belowRecommendedKdf = isBelowOwaspRecommendedArgon2id(
        Number(memLimit),
        Number(opsLimit),
    );
    const submitBlockedByKdf = belowRecommendedKdf && !kdfRiskAcknowledged;

    const tryCreateVault = async (
        formData: NewVaultFormSchemaType & EncryptionFormGroupSchemaType,
    ) => {
        await new Promise((resolve) => setTimeout(resolve, 100));
        await executeCallback(
            formData,
            {
                secondFactor: secondFactorSource,
            },
            initialImport ?? undefined,
        );
    };

    return (
        <div>
            <div className="space-y-4 pt-4">
                <div className="space-y-2">
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
                    <FormInput
                        id="secret-key"
                        type="password"
                        placeholder="Enter your secret key"
                        className="pr-10"
                        showPasswordGenerator={true}
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
                    <PasswordStrengthMeter password={secret} />
                </div>

                <div className="space-y-2">
                    <SecondFactorOptions
                        value={secondFactorChoice}
                        onChange={(choice, source) => {
                            setSecondFactorChoice(choice);
                            setSecondFactorSource(source);
                        }}
                    />
                    <p className="text-xs text-muted-foreground">
                        A second factor adds a separate key on top of your
                        secret key, so an attacker who learns or guesses your
                        secret still cannot open the vault. Recommended if your
                        vault holds high-value credentials.
                    </p>
                </div>

                <div className="space-y-2 rounded-md border p-3">
                    <div className="flex items-start justify-between gap-3">
                        <div>
                            <p className="text-sm font-medium">
                                Import existing passwords
                            </p>
                            <p className="text-xs text-muted-foreground">
                                Optional. Add exported passwords to this vault
                                before it is encrypted.
                            </p>
                        </div>
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => setIsImportWizardOpen(true)}
                            disabled={isSubmitting}
                        >
                            <FileUp className="mr-2 h-4 w-4" />
                            {initialImport ? "Change" : "Import"}
                        </Button>
                    </div>

                    {initialImport ? (
                        <div className="flex items-center justify-between rounded-md bg-muted/50 p-2 text-xs">
                            <span>
                                {initialImport.credentials.length} items,{" "}
                                {initialImport.groups.length} groups
                                {initialImport.warnings.length
                                    ? `, ${initialImport.warnings.length} warnings`
                                    : ""}
                            </span>
                            <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7"
                                onClick={() => setInitialImport(null)}
                                aria-label="Remove import"
                            >
                                <X className="h-3.5 w-3.5" />
                            </Button>
                        </div>
                    ) : null}
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
                                <KdfBelowRecommendedAck
                                    memLimit={Number(memLimit)}
                                    opsLimit={Number(opsLimit)}
                                    acknowledged={kdfRiskAcknowledged}
                                    onAcknowledgedChange={
                                        setKdfRiskAcknowledged
                                    }
                                />
                                {errors.EncryptionConfig && (
                                    <p className="text-destructive-foreground">
                                        {errors.EncryptionConfig.message}
                                    </p>
                                )}
                            </AccordionContent>
                        </AccordionItem>
                    </Accordion>
                </div>
            </div>
            <div className="mt-6">
                <Button
                    className="w-full"
                    onClick={handleSubmit(tryCreateVault)}
                    disabled={isSubmitting || submitBlockedByKdf}
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
            <ImportWizard
                open={isImportWizardOpen}
                onOpenChange={setIsImportWizardOpen}
                onConfirm={(result) => {
                    setInitialImport(result);
                }}
            />
        </div>
    );
};

export default CreateVaultTab;
