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
import { AdditionalKeyProtectionKind } from "@cryptex-industries/vault-core/proto";
import type { AdditionalKeyProtectionSource } from "@cryptex-industries/vault-core/vault-utils/additional-key-protection";

export type AdditionalKeyProtectionChoice =
    | "none"
    | "protectionPhrase128"
    | "protectionPhrase256"
    | "webauthn";

const choiceToSource = (
    choice: AdditionalKeyProtectionChoice,
): AdditionalKeyProtectionSource => {
    switch (choice) {
        case "protectionPhrase128":
            return { kind: AdditionalKeyProtectionKind.PROTECTION_PHRASE_128 };
        case "protectionPhrase256":
            return { kind: AdditionalKeyProtectionKind.PROTECTION_PHRASE_256 };
        case "webauthn":
            return { kind: AdditionalKeyProtectionKind.WEBAUTHN_PRF };
        default:
            return { kind: AdditionalKeyProtectionKind.NONE };
    }
};

type Props = {
    value: AdditionalKeyProtectionChoice;
    onChange: (
        choice: AdditionalKeyProtectionChoice,
        source: AdditionalKeyProtectionSource,
    ) => void;
    allowWebAuthn?: boolean;
};

export function AdditionalKeyProtectionOptions({
    value,
    onChange,
    allowWebAuthn = true,
}: Props) {
    return (
        <div className="space-y-2">
            <p className="text-sm font-medium">Additional key protection</p>
            <div className="flex items-center gap-2">
                <Select
                    value={value}
                    onValueChange={(v) => {
                        const choice = v as AdditionalKeyProtectionChoice;
                        onChange(choice, choiceToSource(choice));
                    }}
                >
                    <SelectTrigger aria-label="Additional key protection">
                        <SelectValue placeholder="Password only" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="none">Password only</SelectItem>
                        <SelectItem value="protectionPhrase128">
                            Generated protection phrase (128-bit)
                        </SelectItem>
                        <SelectItem value="protectionPhrase256">
                            Generated protection phrase (256-bit)
                        </SelectItem>
                        {allowWebAuthn && (
                            <SelectItem value="webauthn">
                                Security key (WebAuthn PRF)
                            </SelectItem>
                        )}
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
                            cached key.
                            {allowWebAuthn &&
                                " WebAuthn stays bound to the enrolled security key and browser."}
                        </p>
                    </PopoverContent>
                </Popover>
            </div>
        </div>
    );
}

export { choiceToSource };
