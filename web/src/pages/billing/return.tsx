import { useEffect } from "react";
import Head from "next/head";
import { useRouter } from "next/router";
import { ArrowUpRight } from "lucide-react";

import { Label, Site, s } from "@/components/marketing/site";
import { billingReturnDestination } from "@/lib/billing-return";

export default function BillingReturnPage() {
    const router = useRouter();
    const destination = router.isReady
        ? billingReturnDestination(router.query)
        : null;

    useEffect(() => {
        if (destination) {
            // Browsers may require a tap for app links; the button stays available.
            void router.replace(destination).catch(() => undefined);
        }
    }, [destination, router]);

    return (
        <Site
            title="Return to Cryptex"
            description="Return to Cryptex Vault to refresh your membership status."
        >
            <Head>
                <meta name="robots" content="noindex, nofollow" />
                <meta name="referrer" content="no-referrer" />
            </Head>
            <section className={s.pageHero}>
                <Label>ONLINE SERVICES</Label>
                <h1>Return to Cryptex Vault</h1>
                {!router.isReady ? (
                    <p role="status">Preparing your return…</p>
                ) : destination ? (
                    <>
                        <p>
                            Return to your vault to refresh your membership
                            status. You can close this browser tab after
                            returning.
                        </p>
                        <div className={s.actions}>
                            <a
                                className={`${s.button} inline-flex min-h-[50px] items-center justify-between gap-[28px] px-[23px] py-[16px] text-[13px] font-medium leading-[1.4]`}
                                href={destination}
                            >
                                Return to Cryptex Vault
                                <ArrowUpRight size={17} aria-hidden="true" />
                            </a>
                        </div>
                    </>
                ) : (
                    <p role="alert">
                        This return link is invalid. Open Cryptex Vault directly
                        to check your membership status.
                    </p>
                )}
            </section>
        </Site>
    );
}
