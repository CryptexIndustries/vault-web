import { ChangelogEntries } from "@/components/changelog";
import { Label, Site, s } from "@/components/marketing/site";

export default function Changelog() {
    return (
        <Site
            title="Changelog"
            description="Release notes for Cryptex Vault: features, fixes and changes to the web vault and Chromium Extension."
        >
            <section className={s.pageHero}>
                <Label>RELEASE NOTES</Label>
                <h1>What changed.</h1>
                <p>
                    Features, fixes and changes to Cryptex Vault. These are the
                    same release notes available inside the app.
                </p>
            </section>
            <ChangelogEntries website />
        </Site>
    );
}
