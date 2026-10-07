import { Label, Section, Site, s } from "@/components/marketing/site";
import {
    DocCard,
    DocsGrid,
    docsStyles as d,
} from "@/components/marketing/doc-article";

const userGuides = [
    [
        "Getting started",
        "/docs/getting-started",
        "Create a vault, save its recovery code, and find your saved logins.",
    ],
    [
        "Importing passwords",
        "/docs/importing",
        "Move data from another password manager or browser and check the result.",
    ],
    [
        "Chromium Extension & autofill",
        "/docs/browser-extension",
        "Install the Chromium Extension, link your vault, and fill a login.",
    ],
    [
        "Linking devices",
        "/docs/linking-devices",
        "Connect your vaults using an invitation and run your first sync.",
    ],
    [
        "Backups",
        "/docs/backups",
        "Download an encrypted backup or use managed restore points.",
    ],
    [
        "Recovery",
        "/docs/recovery",
        "Know which recovery secret you need before a device is lost.",
    ],
    [
        "Troubleshooting",
        "/docs/troubleshooting",
        "Work through unlock, import, extension, sync, and restore problems.",
    ],
] as const;

const technicalGuides = [
    [
        "Synchronization",
        "/docs/synchronization",
        "How linking and live device-to-device sync work.",
    ],
    [
        "Online Services",
        "/docs/online-services",
        "Managed connection infrastructure and encrypted backups.",
    ],
    [
        "Self-hosting",
        "/docs/self-hosting",
        "Run the infrastructure that helps devices connect.",
    ],
    [
        "Architecture",
        "/docs/architecture",
        "Storage, application components, and trust boundaries.",
    ],
    [
        "Cryptography",
        "/docs/cryptography",
        "How vault data and synchronization traffic are protected.",
    ],
    [
        "Threat model",
        "/docs/threat-model",
        "What Cryptex Vault protects against and what remains in scope.",
    ],
    [
        "Privacy & metadata",
        "/docs/privacy-and-metadata",
        "Data that stays local and metadata services may process.",
    ],
] as const;

export default function Docs() {
    return (
        <Site
            title="Documentation"
            description="Practical guides for creating, importing, backing up, recovering, and understanding a Cryptex Vault."
        >
            <section className={s.pageHero}>
                <Label>DOCUMENTATION</Label>
                <h1>
                    Use your vault.
                    <br />
                    <em>Understand how it works.</em>
                </h1>
                <p>
                    Start with the task in front of you. The technical guides
                    explain what happens underneath.
                </p>
            </section>
            <Section number="01" label="USE CRYPTEX VAULT">
                <div className={s.sectionHeading}>
                    <h2>Practical guides</h2>
                    <p>
                        Set up your vault, link devices, and manage backups in
                        the web app and Chromium Extension.
                    </p>
                </div>
                <DocsGrid>
                    {userGuides.map(([title, href, description]) => (
                        <DocCard
                            key={href}
                            href={href}
                            title={title}
                            description={description}
                        />
                    ))}
                </DocsGrid>
            </Section>
            <Section number="02" label="HOW IT WORKS">
                <div className={s.sectionHeading}>
                    <h2>Technical guides</h2>
                    <p>
                        Explore vault architecture, encrypted sync, data
                        privacy, and self-hosting.
                    </p>
                </div>
                <div className={d.cardGrid}>
                    {technicalGuides.map(([title, href, description]) => (
                        <DocCard
                            key={href}
                            href={href}
                            title={title}
                            description={description}
                        />
                    ))}
                </div>
            </Section>
        </Site>
    );
}
