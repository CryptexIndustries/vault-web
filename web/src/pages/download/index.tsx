import Link from "next/link";

import {
    Site,
    Label,
    Section,
    Action,
    BROWSER_EXTENSION,
    s,
} from "@/components/marketing/site";
import d from "@/styles/Download.module.css";

export default function Downloads() {
    return (
        <Site
            title="Download"
            description="Use Cryptex Vault in your browser, with the Chromium Extension or on Android."
        >
            <section className={s.pageHero}>
                <Label>PLATFORMS</Label>
                <h1>Download</h1>
                <p>
                    Use Cryptex Vault in your browser, with the Chromium
                    Extension or on Android.
                </p>
            </section>
            <Section>
                <div className={d.platforms}>
                    <article>
                        <h3>Web app</h3>
                        <p>
                            Nothing to install. Open it in your browser and
                            create a vault.
                        </p>
                        <Action />
                    </article>
                    <article>
                        <h3>Chromium Extension</h3>
                        <p>
                            Autofill for logins and passkeys in Chrome, Edge,
                            Brave and other Chromium browsers.
                        </p>
                        <Action href={BROWSER_EXTENSION}>
                            Open Chrome Web Store
                        </Action>
                    </article>
                    <article>
                        <h3>Android</h3>
                        <p>
                            Install from our F-Droid repository or as an APK
                            from GitHub. Google Play and F-Droid are reviewing
                            it.
                        </p>
                        <Action href="/download/android">
                            Get the Android app
                        </Action>
                    </article>
                    <article className={d.soon}>
                        <h3>SSH agent for Linux</h3>
                        <p>
                            Keeps your SSH keys in the vault. Your phone or the
                            web app approves each signature.
                        </p>
                        <span className={d.status}>In development</span>
                    </article>
                </div>
                <p className={d.planned}>
                    Firefox and iOS are planned.{" "}
                    <Link href="/roadmap">See the roadmap</Link>
                </p>
            </Section>
        </Site>
    );
}
