import { View } from "react-native";
import { useLingui } from "@lingui/react/macro";

import { KeyDerivationConfig_Argon2ID } from "@cryptex-industries/vault-core/vault-utils/encryption";
import { isBelowOwaspRecommendedArgon2id } from "@cryptex-industries/vault-core/vault-utils/password-strength";
import { Checkbox } from "@/components/ui/checkbox";
import { Text } from "@/components/ui/text";
import { InlineNotice } from "@/components/inline-notice";

type Props = {
    memLimit: number;
    opsLimit: number;
    acknowledged: boolean;
    onAcknowledgedChange: (value: boolean) => void;
};

export function KdfBelowRecommendedAck({
    memLimit,
    opsLimit,
    acknowledged,
    onAcknowledgedChange,
}: Props) {
    const { t } = useLingui();
    if (!isBelowOwaspRecommendedArgon2id(memLimit, opsLimit)) {
        return null;
    }
    const recommendedMemory =
        KeyDerivationConfig_Argon2ID.RECOMMENDED_MEM_LIMIT;
    const recommendedPasses =
        KeyDerivationConfig_Argon2ID.RECOMMENDED_OPS_LIMIT;

    return (
        <View className="gap-2">
            <InlineNotice
                tone="warning"
                message={t`Memory and/or operations are below the OWASP-recommended Argon2id minimum (${recommendedMemory} MiB, ${recommendedPasses} passes). Weaker settings make offline cracking of a stolen backup much faster.`}
            />
            <Checkbox
                checked={acknowledged}
                onCheckedChange={onAcknowledgedChange}
                label={t`I understand the risk and want to use these key derivation settings anyway.`}
            />
            <Text className="text-xs text-muted-foreground">
                {t`Mobile recommended default is 128 MiB / ops 3.`}
            </Text>
        </View>
    );
}
