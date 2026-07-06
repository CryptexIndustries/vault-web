import type { OnlineServicesSessionPort } from "@/app_lib/online-services-session/port";

import {
    ensureFreshOnlineServicesSessionViaSW,
    forceReauthenticateOnlineServicesSessionViaSW,
} from "../../utils/online-services-session-client";

export type { OnlineServicesSessionPort };

export const onlineServicesSessionPort: OnlineServicesSessionPort = {
    ensureFresh: ensureFreshOnlineServicesSessionViaSW,
    forceReauthenticate: forceReauthenticateOnlineServicesSessionViaSW,
};
