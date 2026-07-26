import type { OnlineServicesSessionPort } from "@cryptex-industries/vault-core/online-services-session/port";

import {
    ensureFreshOnlineServicesSessionViaSW,
    forceReauthenticateOnlineServicesSessionViaSW,
} from "../../utils/online-services-session-client";

export type { OnlineServicesSessionPort };

export const onlineServicesSessionPort: OnlineServicesSessionPort = {
    ensureFresh: ensureFreshOnlineServicesSessionViaSW,
    forceReauthenticate: forceReauthenticateOnlineServicesSessionViaSW,
};
