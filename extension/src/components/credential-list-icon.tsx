import { Globe } from "lucide-react";

/**
 * Keep credential list icons local. Loading an image from a credential URL
 * would disclose stored domains and issue one network request per entry.
 */
export function CredentialListIcon() {
    return (
        <div
            aria-hidden="true"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted"
        >
            <Globe className="h-4 w-4" />
        </div>
    );
}
