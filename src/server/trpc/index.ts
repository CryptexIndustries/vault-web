// src/server/router/index.ts
import {
    credentialsRouterGenerateAuthNonce,
    credentialsRouterRegisterUser,
    credentialsRouterConfirm,
} from "./routes/credentials.router";
import {
    notifyMeRouterRegister,
    notifyMeRouterContact,
} from "./routes/notifyme.router";
import {
    accountRouterGetLinkingConfiguration,
    accountRouterLinkDevice,
    accountRouterUnlinkDevice,
    accountRouterGetLinkedDevices,
    accountRouterDeleteUser,
} from "./routes/account.router";
import {
    paymentRouterGetCheckoutSession,
    paymentRouterGetCheckoutURL,
    paymentRouterGetSubscription,
    paymentRouterGetCustomerPortal,
} from "./routes/payment.router";
import {
    featureVotingRouterOpenRoundExists,
    featureVotingRouterGetRounds,
    featureVotingRouterPlaceVote,
} from "./routes/feature-voting.router";
import { router } from "./trpc";

const mainRouter = router({
    notifyme: router({
        register: notifyMeRouterRegister,
        contact: notifyMeRouterContact,
    }),
    credentials: router({
        generateAuthNonce: credentialsRouterGenerateAuthNonce,
        registerUser: credentialsRouterRegisterUser,
        confirm: credentialsRouterConfirm,
    }),
    account: router({
        getLinkingConfiguration: accountRouterGetLinkingConfiguration,
        linkDevice: accountRouterLinkDevice,
        unlinkDevice: accountRouterUnlinkDevice,
        getLinkedDevices: accountRouterGetLinkedDevices,
        deleteUser: accountRouterDeleteUser,
    }),
    payment: router({
        getCheckoutSession: paymentRouterGetCheckoutSession,
        getCheckoutURL: paymentRouterGetCheckoutURL,
        getSubscription: paymentRouterGetSubscription,
        getCustomerPortal: paymentRouterGetCustomerPortal,
    }),
    featureVoting: router({
        openRoundExists: featureVotingRouterOpenRoundExists,
        getRounds: featureVotingRouterGetRounds,
        placeVote: featureVotingRouterPlaceVote,
    }),
});

export const appRouter = mainRouter;

// export type definition of API
export type AppRouter = typeof appRouter;
