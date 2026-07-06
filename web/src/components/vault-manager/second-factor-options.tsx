import { Info } from "lucide-react";
import { Label } from "@/components/ui/label";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover";
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
        <div className="flex gap-2 space-y-2">
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
            <Popover>
                <PopoverTrigger asChild>
                    <Info
                        className="cursor-help text-muted-foreground transition-colors hover:text-foreground"
                        strokeWidth={1.5}
                    />
                </PopoverTrigger>
                <PopoverContent
                    className="w-80 space-y-2 text-xs"
                    side="top"
                    align="start"
                >
                    <p>
                        Generated passphrases are derived from your backup
                        secret, so they will be regenerated automatically after
                        a backup restore.
                    </p>
                    <p>
                        If you write one down and restore from a different
                        device, the regenerated passphrase will not match and
                        you will need to re-enroll. WebAuthn is device-bound and
                        stays bound to the enrolled security key and browser.
                    </p>
                </PopoverContent>
            </Popover>
        </div>
    );
}

export { choiceToSource };
