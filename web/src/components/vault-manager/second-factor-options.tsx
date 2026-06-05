import { Label } from "@/components/ui/label";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { SecondFactorKind } from "@/app_lib/proto/vault";
import type { SecondFactorSource } from "@/app_lib/vault-utils/second-factor";

export type SecondFactorChoice =
    | "none"
    | "passphrase128"
    | "passphrase256"
    | "webauthn";

const choiceToSource = (choice: SecondFactorChoice): SecondFactorSource => {
    switch (choice) {
        case "passphrase128":
            return { kind: SecondFactorKind.PASSPHRASE_128 };
        case "passphrase256":
            return { kind: SecondFactorKind.PASSPHRASE_256 };
        case "webauthn":
            return { kind: SecondFactorKind.WEBAUTHN_PRF };
        default:
            return { kind: SecondFactorKind.NONE };
    }
};

type Props = {
    value: SecondFactorChoice;
    onChange: (choice: SecondFactorChoice, source: SecondFactorSource) => void;
};

export function SecondFactorOptions({ value, onChange }: Props) {
    return (
        <div className="space-y-2">
            <Label>Second factor (optional)</Label>
            <Select
                value={value}
                onValueChange={(v) => {
                    const choice = v as SecondFactorChoice;
                    onChange(choice, choiceToSource(choice));
                }}
            >
                <SelectTrigger>
                    <SelectValue placeholder="None" />
                </SelectTrigger>
                <SelectContent>
                    <SelectItem value="none">None (secret only)</SelectItem>
                    <SelectItem value="passphrase128">
                        Generated passphrase (128-bit)
                    </SelectItem>
                    <SelectItem value="passphrase256">
                        Generated passphrase (256-bit)
                    </SelectItem>
                    <SelectItem value="webauthn">
                        Security key (WebAuthn PRF)
                    </SelectItem>
                </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
                Generated passphrases work after backup restore if written down.
                WebAuthn stays bound to the enrolled security key/browser.
            </p>
        </div>
    );
}

export { choiceToSource };
