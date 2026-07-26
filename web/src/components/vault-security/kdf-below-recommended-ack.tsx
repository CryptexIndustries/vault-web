import { TriangleAlert } from "lucide-react";

import { KeyDerivationConfig_Argon2ID } from "@cryptex-industries/vault-core/vault-utils/encryption";
import { isBelowOwaspRecommendedArgon2id } from "@cryptex-industries/vault-core/vault-utils/password-strength";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";

type Props = {
    memLimit: number;
    opsLimit: number;
    acknowledged: boolean;
    onAcknowledgedChange: (value: boolean) => void;
    compact?: boolean;
    className?: string;
};

export function KdfBelowRecommendedAck({
    memLimit,
    opsLimit,
    acknowledged,
    onAcknowledgedChange,
    compact = false,
    className,
}: Props) {
    if (!isBelowOwaspRecommendedArgon2id(memLimit, opsLimit)) {
        return null;
    }

    const textClass = compact ? "text-[10px] leading-snug" : "text-xs";

    return (
        <Alert
            variant="destructive"
            className={cn(compact && "px-3 py-2", className)}
        >
            <TriangleAlert className="h-4 w-4" />
            <AlertDescription className="space-y-2">
                <p className={textClass}>
                    Memory and/or operations are below the OWASP-recommended
                    Argon2id minimum (
                    {KeyDerivationConfig_Argon2ID.RECOMMENDED_MEM_LIMIT} MiB,{" "}
                    {KeyDerivationConfig_Argon2ID.RECOMMENDED_OPS_LIMIT}{" "}
                    passes). Weaker settings make offline cracking of a stolen
                    backup or sync blob much faster.
                </p>
                <label
                    className={cn(
                        "flex cursor-pointer items-start gap-2",
                        textClass,
                    )}
                >
                    <Checkbox
                        checked={acknowledged}
                        onCheckedChange={(checked) =>
                            onAcknowledgedChange(checked === true)
                        }
                        className="mt-0.5"
                    />
                    <span>
                        I understand the risk and want to use these key
                        derivation settings anyway.
                    </span>
                </label>
            </AlertDescription>
        </Alert>
    );
}
