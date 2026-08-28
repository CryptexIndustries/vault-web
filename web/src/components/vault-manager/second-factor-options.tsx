import { Info } from "lucide-react";
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
import { SecondFactorKind } from "@cryptex-industries/vault-core/proto";
import type { SecondFactorSource } from "@cryptex-industries/vault-core/vault-utils/second-factor";

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
            <p className="text-sm font-medium">Additional key protection</p>
            <div className="flex items-center gap-2">
                <Select
                    value={value}
                    onValueChange={(v) => {
                        const choice = v as SecondFactorChoice;
                        onChange(choice, choiceToSource(choice));
                    }}
                >
                    <SelectTrigger aria-label="Additional key protection">
                        <SelectValue placeholder="Password only" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="none">Password only</SelectItem>
                        <SelectItem value="passphrase128">
                            Generated protection phrase (128-bit)
                        </SelectItem>
                        <SelectItem value="passphrase256">
                            Generated protection phrase (256-bit)
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
                            A generated protection phrase is created at random.
                            Its derived key is cached on this device for
                            convenient unlocks.
                        </p>
                        <p>
                            Save the phrase when it is shown. You will need it
                            after restoring a backup or on a device without the
                            cached key. WebAuthn stays bound to the enrolled
                            security key and browser.
                        </p>
                    </PopoverContent>
                </Popover>
            </div>
        </div>
    );
}

export { choiceToSource };
