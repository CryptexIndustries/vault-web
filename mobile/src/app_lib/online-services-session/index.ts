import {
    ensureFreshOnlineServicesSession,
    forceOnlineServicesSessionReauthentication,
} from "@/app_lib/auth-session";

import type { OnlineServicesSessionPort } from "@cryptex-industries/vault-core/online-services-session/port";

/** Session refresh and reauthentication for the vault-core runtime. */
export const onlineServicesSessionPort: OnlineServicesSessionPort = {
    ensureFresh: ensureFreshOnlineServicesSession,
    forceReauthenticate: forceOnlineServicesSessionReauthentication,
};
