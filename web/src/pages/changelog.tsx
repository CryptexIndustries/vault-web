import { useRouter } from "next/router";
import {
    ChangelogEntries,
    ChangelogPicker,
    isChangelogKey,
} from "@/components/changelog";
import { Label, Site, s } from "@/components/marketing/site";

export default function Changelog() {
    const router = useRouter();
    const changelog = isChangelogKey(router.query.component)
        ? router.query.component
        : "web";

    return (
        <Site
            title="Changelog"
            description="Release notes for Cryptex Vault: features, fixes and changes to the web app, Chromium Extension, Android app, SSH agent and servers."
        >
            <section className={s.pageHero}>
                <Label>RELEASE NOTES</Label>
                <h1>What changed.</h1>
                <p>
                    Features, fixes and changes to Cryptex Vault. These are the
                    same release notes available inside the app.
                </p>
            </section>
            <div className="px-[5%] pt-[40px] max-[700px]:pr-0 max-[700px]:pt-[28px]">
                <ChangelogPicker
                    value={changelog}
                    onChange={(key) =>
                        router.replace(
                            { query: key === "web" ? {} : { component: key } },
                            undefined,
                            { shallow: true, scroll: false },
                        )
                    }
                    className={`${s.billing} max-w-[850px] gap-[8px] max-[700px]:pr-[5%]`}
                />
            </div>
            <ChangelogEntries changelog={changelog} website />
        </Site>
    );
}
