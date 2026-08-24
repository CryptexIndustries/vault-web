import { Fingerprint, Globe } from "lucide-react";
import { ItemType } from "@cryptex-industries/vault-core/proto";

/**
 * Keep credential list icons local. Loading an image from a credential URL
 * would disclose stored domains and issue one network request per entry.
 */
export function CredentialListIcon({ type }: { type?: ItemType }) {
    return (
        <div
            aria-hidden="true"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted"
        >
            {type === ItemType.Passkey ? (
                <Fingerprint className="h-4 w-4 text-primary" />
            ) : (
                <Globe className="h-4 w-4" />
            )}
        </div>
    );
}
