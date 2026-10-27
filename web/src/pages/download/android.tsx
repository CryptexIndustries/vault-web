import Link from "next/link";
import { useEffect, useState } from "react";
import QRCode from "react-qr-code";
import { Check, Copy } from "lucide-react";

import {
    Site,
    Label,
    Section,
    Action,
    GOOGLE_PLAY,
    REPO,
    s,
} from "@/components/marketing/site";
import d from "@/styles/Download.module.css";

// Update these if the F-Droid repository moves or its signing key changes.
const FDROID_REPO = "https://cryptexindustries.com/fdroid/repo";
const FDROID_FINGERPRINT =
    "14a3bba7affad3b4105f3285bcfc9fd69f0972894ba73c56d2c8f62e8021ecba";
const FDROID_REPO_URL = `${FDROID_REPO}?fingerprint=${FDROID_FINGERPRINT}`;
// F-Droid clients open this scheme with the add-repository screen.
const FDROID_ADD_LINK = FDROID_REPO_URL.replace(/^https:/, "fdroidrepos:");
// GitHub's release search matches titles and notes, not tags, so this also
// lists web and extension releases whose notes mention Android.
const ANDROID_RELEASES = `${REPO}/releases?q=Android&expanded=true`;

function CopyField({ label, value }: { label: string; value: string }) {
    const [status, setStatus] = useState<"idle" | "copied" | "failed">("idle");
    useEffect(() => {
        if (status === "idle") return;
        const timer = setTimeout(() => setStatus("idle"), 3000);
        return () => clearTimeout(timer);
    }, [status]);
    return (
        <div className={d.field}>
            <div className="flex items-center justify-between gap-4">
                <span>{label}</span>
                <button
                    type="button"
                    aria-label={`Copy ${label.toLowerCase()}`}
                    onClick={async () => {
                        try {
                            await navigator.clipboard.writeText(value);
                            setStatus("copied");
                        } catch {
                            setStatus("failed");
                        }
                    }}
                >
                    {status === "copied" ? (
                        <Check size={14} />
                    ) : (
                        <Copy size={14} />
                    )}
                    {status === "copied"
                        ? "Copied"
                        : status === "failed"
                          ? "Retry"
                          : "Copy"}
                </button>
            </div>
            <code>{value}</code>
            <span role="status" className="sr-only">
                {status === "copied"
                    ? "Copied"
                    : status === "failed"
                      ? "Copy failed. Select the text to copy it manually."
                      : ""}
            </span>
        </div>
    );
}

export default function Download() {
    return (
        <Site
            title="Get the Android app"
            description="Install Cryptex Vault on Android from Google Play or our F-Droid repository, or download the signed APK."
        >
            <section className={s.pageHero}>
                <Link href="/download" className={d.back}>
                    All downloads
                </Link>
                <Label>ANDROID</Label>
                <h1>Cryptex Vault for Android</h1>
                <p>
                    Install it from Google Play, or add our F-Droid repository
                    and your F-Droid client installs new versions as we release
                    them.
                </p>
                <div className={s.actions}>
                    <Action href={GOOGLE_PLAY}>Get it on Google Play</Action>
                    <Action href={FDROID_ADD_LINK} secondary>
                        Add to F-Droid
                    </Action>
                    <Action href="#apk" secondary>
                        Download the APK
                    </Action>
                </div>
            </section>
            <Section id="fdroid" number="01" label="F-DROID REPOSITORY">
                <div className={s.sectionHeading}>
                    <h2>Add our repository</h2>
                    <p>Works with F-Droid, Droid-ify and Neo Store.</p>
                </div>
                <div className={d.repoGrid}>
                    <div className={d.repoCard}>
                        <div className={d.qr}>
                            <QRCode
                                value={FDROID_REPO_URL}
                                size={184}
                                bgColor="#fcf8ec"
                                fgColor="#181d2b"
                                title="F-Droid repository address"
                            />
                        </div>
                        <p className={d.qrHint}>
                            Scan with your F-Droid client to add the repository.
                        </p>
                        <CopyField label="Repository" value={FDROID_REPO} />
                        <CopyField
                            label="Fingerprint (SHA-256)"
                            value={FDROID_FINGERPRINT}
                        />
                    </div>
                    <ol className={d.steps}>
                        <li>
                            <h3>Install an F-Droid client</h3>
                            <p>
                                Get F-Droid from{" "}
                                <a href="https://f-droid.org">f-droid.org</a>,
                                or use Droid-ify or Neo Store if you already
                                have one.
                            </p>
                        </li>
                        <li>
                            <h3>Add the repository</h3>
                            <p>
                                On your phone, tap <b>Add to F-Droid</b> above.
                                You can also scan the QR code or paste the
                                repository address in your client&apos;s
                                repository settings.
                            </p>
                        </li>
                        <li>
                            <h3>Check the fingerprint</h3>
                            <p>
                                Your client shows the repository&apos;s
                                fingerprint before adding it. It must match the
                                one on this page. If it doesn&apos;t, cancel and{" "}
                                <a href="mailto:support@cryptex-vault.com">
                                    contact us
                                </a>
                                .
                            </p>
                        </li>
                        <li>
                            <h3>Install Cryptex Vault</h3>
                            <p>Search for Cryptex Vault and install it.</p>
                        </li>
                    </ol>
                </div>
            </Section>
            <Section id="apk" number="02" label="OTHER WAYS TO INSTALL">
                <div className={s.sectionHeading}>
                    <h2>APK and app stores</h2>
                    <p>
                        Our F-Droid repository and the GitHub release carry the
                        same signed APKs.
                    </p>
                </div>
                <div className={d.sources}>
                    <article>
                        <h3>APK from GitHub</h3>
                        <p>
                            Download the APK from the newest Android release.
                            Most phones need the arm64-v8a build, and SHA256SUMS
                            is listed next to it. An APK doesn&apos;t update
                            itself, so you&apos;ll have to check for new
                            releases.
                        </p>
                        <Action href={ANDROID_RELEASES}>
                            Open Android releases
                        </Action>
                    </article>
                    <article className={d.soon}>
                        <h3>F-Droid</h3>
                        <p>
                            We&apos;ve submitted Cryptex Vault to the main
                            F-Droid repository. Once it&apos;s accepted, F-Droid
                            builds it from our source.
                        </p>
                        <span className={d.status}>In review</span>
                    </article>
                    <article>
                        <h3>Google Play</h3>
                        <p>
                            Play installs updates for you. Online Services
                            bought in the app are billed through Google Play.
                            Google signs the Play copy with its own key, so to
                            switch from an APK or F-Droid install, export your
                            vault, uninstall the app and install it from Play.
                        </p>
                        <Action href={GOOGLE_PLAY}>Open Google Play</Action>
                    </article>
                </div>
            </Section>
        </Site>
    );
}
