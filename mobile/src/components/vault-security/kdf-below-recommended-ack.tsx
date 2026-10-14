import { View } from "react-native";

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
    if (!isBelowOwaspRecommendedArgon2id(memLimit, opsLimit)) {
        return null;
    }

    return (
        <View className="gap-2">
            <InlineNotice
                tone="warning"
                message={`Memory and/or operations are below the OWASP-recommended Argon2id minimum (${KeyDerivationConfig_Argon2ID.RECOMMENDED_MEM_LIMIT} MiB, ${KeyDerivationConfig_Argon2ID.RECOMMENDED_OPS_LIMIT} passes). Weaker settings make offline cracking of a stolen backup much faster.`}
            />
            <Checkbox
                checked={acknowledged}
                onCheckedChange={onAcknowledgedChange}
                label="I understand the risk and want to use these key derivation settings anyway."
            />
            <Text className="text-xs text-muted-foreground">
                Mobile recommended default is 128 MiB / ops 3.
            </Text>
        </View>
    );
}
