import {
    Site,
    Label,
    Section,
    Action,
    APP_STORE,
    CHROME_WEB_STORE,
    FIREFOX_ADD_ONS,
    s,
} from "@/components/marketing/site";
import d from "@/styles/Download.module.css";

export default function Downloads() {
    return (
        <Site
            title="Download"
            description="Use Cryptex Vault in your browser, with the Browser Extension or on Android and iOS."
        >
            <section className={s.pageHero}>
                <Label>PLATFORMS</Label>
                <h1>Download</h1>
                <p>
                    Use Cryptex Vault in your browser, with the Browser
                    Extension or on Android and iOS.
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
                        <h3>Browser Extension</h3>
                        <p>
                            Autofill for logins and passkeys in Firefox, Chrome,
                            Edge, Brave and other Chromium browsers.
                        </p>
                        <div className="mt-auto flex flex-col gap-3">
                            <Action href={CHROME_WEB_STORE}>
                                Open Chrome Web Store
                            </Action>
                            <Action href={FIREFOX_ADD_ONS}>
                                Open Firefox Add-ons
                            </Action>
                        </div>
                    </article>
                    <article>
                        <h3>Android and iOS</h3>
                        <p>
                            On Android, install from Google Play, our F-Droid
                            repository or as an APK from GitHub. The main
                            F-Droid repository is reviewing it. On iPhone and
                            iPad, install from the App Store.
                        </p>
                        <div className="mt-auto flex flex-col gap-3">
                            <Action href="/download/android">
                                Get the Android app
                            </Action>
                            <Action href={APP_STORE}>Open App Store</Action>
                        </div>
                    </article>
                    <article>
                        <h3>SSH agent for Linux and macOS</h3>
                        <p>
                            Keeps your SSH keys in the vault. Your phone or the
                            web app approves each signature.
                        </p>
                        <Action href="/docs/ssh-agent">
                            Set up the SSH agent
                        </Action>
                    </article>
                </div>
            </Section>
        </Site>
    );
}
