import { Fingerprint, Globe } from "lucide-react";
import { ItemType } from "@cryptex-industries/vault-core/proto";

/**
 * Keep credential list icons local. Loading an image from a credential URL
 * would disclose stored domains and issue one network request per entry.
 */
export function CredentialListIcon({
    type,
    hasPasskey = false,
}: {
    type?: ItemType;
    hasPasskey?: boolean;
}) {
    return (
        <div
            aria-hidden="true"
            className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted"
        >
            {type === ItemType.Passkey ? (
                <Fingerprint className="h-4 w-4 text-primary" />
            ) : (
                <Globe className="h-4 w-4" />
            )}
            {type !== ItemType.Passkey && hasPasskey ? (
                <span className="absolute -bottom-0.5 -right-0.5 rounded-full bg-background p-0.5 text-primary">
                    <Fingerprint className="h-3 w-3" />
                </span>
            ) : null}
        </div>
    );
}
