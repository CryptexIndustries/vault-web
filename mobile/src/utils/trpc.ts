import { createTRPCClient, type TRPCLink } from "@trpc/client";
import { createTRPCReact } from "@trpc/react-query";
import type { VersionedRouter } from "@cryptex-industries/api-contract";
import {
    createBareAuthHeader,
    ensureFreshOnlineServicesSession,
} from "@/app_lib/auth-session";
import { onlineServicesLinks } from "./online-services-transport";
import { getVaultSessionGeneration } from "./vault-session";

const bindRequestToVault: TRPCLink<VersionedRouter> =
    () =>
    ({ op, next }) =>
        next({
            ...op,
            context: {
                ...op.context,
                mobileVaultGeneration: getVaultSessionGeneration(),
            },
        });

function authenticatedLinks() {
    return [
        bindRequestToVault,
        ...onlineServicesLinks(async ({ opList }) => {
            const assertCurrent = () => {
                if (
                    opList.some(
                        (op) =>
                            op.context.mobileVaultGeneration !==
                            getVaultSessionGeneration(),
                    )
                ) {
                    throw new Error(
                        "Online Services request belongs to a previous vault session.",
                    );
                }
            };
            assertCurrent();
            if (opList.some((op) => !op.path.startsWith("v1.auth."))) {
                await ensureFreshOnlineServicesSession();
            }
            assertCurrent();
            return createBareAuthHeader();
        }),
    ];
}

// All consumers use the same configured mobile API, including React Query.
export const reactQueryClientConfig = () => ({
    links: authenticatedLinks(),
});
export const trpcReact = createTRPCReact<VersionedRouter>({});
export const trpc = createTRPCClient<VersionedRouter>({
    links: authenticatedLinks(),
});
