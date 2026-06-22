import {
    ensureFreshOnlineServicesSession,
    forceOnlineServicesSessionReauthentication,
} from "../auth-session";

import type { OnlineServicesSessionPort } from "./port";

export const onlineServicesSessionPort: OnlineServicesSessionPort = {
    ensureFresh: ensureFreshOnlineServicesSession,
    forceReauthenticate: forceOnlineServicesSessionReauthentication,
};
