import Link from "next/link";
import Image from "next/image";
import { useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import {
    ArrowRight,
    ArrowLeft,
    ArrowDown,
    ArrowUpRight,
    Expand,
    X,
} from "lucide-react";
import {
    Site,
    Label,
    Action,
    Section,
    Network,
    Plans,
    FinalCTA,
    REPO,
    s,
} from "@/components/marketing/site";

const steps = [
    [
        "Your passwords",
        "Import your credentials, then find everything in one local vault.",
        "vault",
    ],
    [
        "Login details",
        "Open a credential to view its details. Connect the Chromium Extension for autofill.",
        "credential",
    ],
    [
        "Linked devices",
        "See when your linked device last synced and choose when it connects and synchronizes.",
        "devices",
    ],
    [
        "In your browser",
        "The linked Chromium Extension receives the same credentials. Both vaults stay on your devices.",
        "extension",
    ],
    [
        "Encrypted backups",
        "Download a manual backup or use Online Services for managed encrypted restore points.",
        "backup",
    ],
    [
        "Create your vault",
        "When you’re ready, create a local vault and keep your recovery information somewhere safe.",
        "create",
    ],
];
function Walkthrough() {
    const [step, setStep] = useState(0);
    const [playing, setPlaying] = useState(false);
    const [expanded, setExpanded] = useState(false);
    useEffect(() => {
        if (!playing) return;
        const timer = window.setInterval(
            () => setStep((current) => (current + 1) % steps.length),
            4500,
        );
        return () => window.clearInterval(timer);
    }, [playing]);
    const current = steps[step]!;
    return (
        <div className={s.walkthrough}>
            <div className={s.walkthroughControls}>
                <span>INSIDE THE APP</span>
                <button
                    onClick={() => setPlaying(!playing)}
                    aria-pressed={playing}
                >
                    {playing ? "Pause walkthrough" : "Play walkthrough"}{" "}
                    <span aria-hidden="true">{playing ? "Ⅱ" : "▷"}</span>
                </button>
            </div>
            <Dialog.Root
                open={expanded}
                onOpenChange={(value) => {
                    setExpanded(value);
                    if (value) setPlaying(false);
                }}
            >
                <div className={s.walkthroughScreen}>
                    <div className={s.screenBar}>
                        <span>
                            <i />
                            <i />
                            <i />
                        </span>
                        <span>
                            {current[2] === "extension"
                                ? "CRYPTEX VAULT / CHROMIUM EXTENSION"
                                : "CRYPTEX VAULT / WEB APPLICATION"}
                        </span>
                        <span>DEMO VAULT</span>
                    </div>
                    <Dialog.Trigger asChild>
                        <button
                            className={s.previewButton}
                            aria-label={`Expand screenshot: ${current[0]}`}
                        >
                            <span
                                className={s.previewCrop}
                                data-screen={current[2]}
                            >
                                <Image
                                    src={`/images/walkthrough/${current[2]}.png`}
                                    alt={`Actual Cryptex Vault interface: ${current[0]}. Demo credentials only.`}
                                    unoptimized
                                    width={
                                        current[2] === "extension" ? 1440 : 2880
                                    }
                                    height={1800}
                                    sizes="(max-width: 720px) 1100px, 80vw"
                                />
                            </span>
                            <span className={s.expandHint}>
                                <Expand size={15} aria-hidden="true" />
                                Expand screenshot
                            </span>
                        </button>
                    </Dialog.Trigger>
                </div>
                <Dialog.Portal>
                    <Dialog.Overlay className={s.viewerOverlay} />
                    <Dialog.Content
                        className={`dark ${s.site} ${s.viewer}`}
                        onKeyDown={(event) => {
                            if (
                                event.key === "ArrowRight" ||
                                event.key === "ArrowLeft"
                            ) {
                                event.preventDefault();
                                setStep(
                                    (value) =>
                                        (value +
                                            (event.key === "ArrowRight"
                                                ? 1
                                                : -1) +
                                            steps.length) %
                                        steps.length,
                                );
                            }
                        }}
                    >
                        <div className={s.viewerHeading}>
                            <div>
                                <Dialog.Title>{current[0]}</Dialog.Title>
                                <Dialog.Description>
                                    {`Screenshot: ${current[0]}`}
                                </Dialog.Description>
                            </div>
                            <Dialog.Close aria-label="Close screenshot">
                                <X />
                            </Dialog.Close>
                        </div>
                        <div className={s.viewerImage}>
                            <Image
                                src={`/images/walkthrough/${current[2]}.png`}
                                alt={`${current[0]} in Cryptex Vault`}
                                unoptimized
                                width={current[2] === "extension" ? 1440 : 2880}
                                height={1800}
                                sizes="94vw"
                            />
                        </div>
                        <div className={s.viewerNavigation}>
                            <button
                                aria-label="Previous screenshot"
                                onClick={() =>
                                    setStep(
                                        (value) =>
                                            (value - 1 + steps.length) %
                                            steps.length,
                                    )
                                }
                            >
                                <ArrowLeft size={18} aria-hidden="true" />
                                <span>Previous</span>
                            </button>
                            <span aria-live="polite" aria-atomic="true">
                                {step + 1} / {steps.length}
                                <span className="sr-only">: {current[0]}</span>
                            </span>
                            <button
                                aria-label="Next screenshot"
                                onClick={() =>
                                    setStep(
                                        (value) => (value + 1) % steps.length,
                                    )
                                }
                            >
                                <span>Next</span>
                                <ArrowRight size={18} aria-hidden="true" />
                            </button>
                        </div>
                    </Dialog.Content>
                </Dialog.Portal>
            </Dialog.Root>
            <div
                className={s.walkthroughSteps}
                aria-label="Product walkthrough"
            >
                {steps.map(([title, description], index) => (
                    <button
                        key={title}
                        aria-pressed={step === index}
                        onClick={() => {
                            setPlaying(false);
                            setStep(index);
                        }}
                    >
                        <span>0{index + 1}</span>
                        <strong>{title}</strong>
                        <p>{description}</p>
                    </button>
                ))}
            </div>
            <p
                className={s.activeStepDescription}
                aria-live={playing ? "off" : "polite"}
            >
                {current[1]}
            </p>
        </div>
    );
}
const faqs = [
    [
        "Does Cryptex Vault store my passwords?",
        "Your encrypted vault lives locally on your devices. If you choose managed backups, Online Services also store an encrypted copy. Vault contents and passwords are not sent to the infrastructure in plaintext.",
    ],
    [
        "Do I need an account?",
        "No account is required for local use. Online Services require a subscription and a separate setup in the app.",
    ],
    [
        "Why do both devices need to be online? Is sync automatic?",
        "Synchronization happens between your devices, without a central vault serving changes while a device is offline. Both vaults must be open, unlocked, and reachable. New links connect and sync automatically by default; you can change those settings or sync manually.",
    ],
    [
        "What if a direct connection cannot be established?",
        "A TURN relay can carry the encrypted traffic between your devices. Synchronization remains end-to-end encrypted; Cryptex Industries d.o.o. cannot read the relayed vault contents.",
    ],
    [
        "What happens if I lose a device - or every device?",
        "Your other devices retain their complete vault. Revoke a lost device’s Online Services permissions promptly; this does not erase its local vault. If every device is lost, you need a manual or managed backup and the required recovery information. Your Online Services Recovery Kit contains the User ID and phrase needed to find available managed backups from your root devices. Your vault password or vault recovery code unlocks the restored vault.",
    ],
    [
        "What if I lose my recovery information?",
        "If you still have access to your vault, secure a backup and your recovery information now. If you lose access, every device, and the required recovery information, Cryptex Industries d.o.o. cannot guarantee recovery or decrypt your vault for you.",
    ],
    [
        "What if Cryptex Industries d.o.o. shuts down? Can I self-host?",
        "Your locally stored vault remains yours. You can export your data and restore manual backups. The source code is public, so you can build the software and run your own sync infrastructure. Managed services depend on Cryptex Industries d.o.o. remaining operational, so keep a separate manual backup.",
    ],
    [
        "Has Cryptex Vault been independently audited?",
        "Not yet. Internal red-team testing has been performed. Independent review is part of the security roadmap; it is not a completed audit.",
    ],
    [
        "How is this different from KeePass, Bitwarden or Vaultwarden?",
        "Cryptex Vault keeps a complete encrypted vault on each device and adds browser autofill and direct device-to-device synchronization. KeePass is commonly file-based, while Bitwarden and Vaultwarden synchronize through a central server. Cryptex Vault synchronizes peer to peer instead, so both devices must be online at the same time. You can self-host the connection infrastructure or use optional managed services. The tradeoff is direct ownership and control instead of always-on server synchronization.",
    ],
    [
        "What does Online Services store?",
        "Managed backups store encrypted vault copies. Signaling and relay infrastructure process connection metadata, which can include IP addresses, timing and WebRTC connection information. Subscription and payment data are separate from vault contents; see the Privacy Policy for their handling.",
    ],
];
export default function Home() {
    return (
        <Site
            title="Cryptex Vault"
            description="A local-first password manager with browser autofill and peer-to-peer synchronization. Free forever, with optional Online Services."
        >
            <section className={s.hero}>
                <div className={s.heroCopy}>
                    <h1>
                        Your password vault
                        <br />
                        lives on <em>your devices.</em>
                    </h1>
                    <p className={s.heroLead}>
                        A local-first password manager.
                        <br />
                        Browser autofill. Peer-to-peer synchronization.
                        <br />
                        Your passwords, within reach.
                    </p>
                    <div className={s.actions}>
                        <Action />
                        <Action href={REPO} secondary>
                            Inspect the code
                        </Action>
                    </div>
                    <p className={s.heroBusiness}>
                        Use it on your own, self-host the sync infrastructure,
                        or choose Online Services for managed P2P infrastructure
                        and encrypted backups.
                    </p>
                </div>
                <Network hero minimal />
                <div className={s.heroFoot}>
                    <span>
                        No account required for local use <b>-</b> AGPL-3.0
                    </span>
                    <a href="#product">
                        EXPLORE THE VAULT <ArrowDown size={14} />
                    </a>
                </div>
            </section>
            <div className={s.importStrip}>
                <span>BRING YOUR PASSWORDS FROM</span>
                <div>
                    {[
                        "Bitwarden",
                        "1Password",
                        "KeePass",
                        "LastPass",
                        "Chrome",
                        "Firefox",
                    ].map((x) => (
                        <span key={x}>{x}</span>
                    ))}
                </div>
            </div>
            <Section id="product">
                <div className={s.sectionHeading}>
                    <h2>
                        Privacy shouldn’t mean
                        <br />
                        giving up convenience.
                    </h2>
                    <p>
                        Start with the passwords you already have. Use them in
                        your browser. Take them with you whenever you leave.
                    </p>
                </div>
                <Walkthrough />
                <div className={s.featureRow}>
                    {[
                        [
                            "Browser autofill",
                            "Use credentials from your encrypted vault through the Chromium Extension.",
                        ],
                        [
                            "An easier move",
                            "Import from Bitwarden, 1Password, KeePass, LastPass, Chrome and Firefox.",
                        ],
                        [
                            "Always portable",
                            "Export your data and create manual encrypted backups at any time.",
                        ],
                    ].map(([title, text]) => (
                        <article key={title}>
                            <ArrowUpRight size={20} />
                            <h3>{title}</h3>
                            <p>{text}</p>
                        </article>
                    ))}
                </div>
            </Section>
            <Section id="architecture" className={s.architectureSection}>
                <div className={s.sectionHeading}>
                    <h2>
                        Your vault doesn’t need
                        <br />
                        to live in our cloud.
                    </h2>
                    <p>
                        Each device holds its own encrypted vault. When you
                        sync, your devices connect directly where possible. A
                        TURN relay carries encrypted traffic when they can’t.
                    </p>
                </div>
                <Network detailed minimal />
                <div className={s.tradeoff}>
                    <span>THE TRADEOFF, UP FRONT</span>
                    <p>
                        Both vaults must be open and unlocked.
                        <br />
                        New links sync automatically when connected.
                    </p>
                    <span>
                        The same rules apply with
                        <br />
                        self-hosted infrastructure and Online Services.
                    </span>
                </div>
            </Section>
            <Section>
                <div className={s.sectionHeading}>
                    <h2>
                        Ownership first.
                        <br />
                        Convenience when you want it.
                    </h2>
                    <p>
                        The password manager is free forever. A subscription
                        pays for managed infrastructure and encrypted backup
                        storage.
                    </p>
                </div>
                <Plans />
                <Link className={s.textLink} href="/pricing">
                    Explore pricing and what’s included <ArrowRight size={16} />
                </Link>
            </Section>
            <Section id="section-recovery" className={s.recoverySection}>
                <div className={s.sectionHeading}>
                    <h2>
                        Your passwords
                        <br />
                        should survive us.
                    </h2>
                    <p>
                        Local ownership matters most when something goes wrong.
                        Keep a backup and preserve your recovery information.
                    </p>
                </div>
                <div className={s.recoveryGrid}>
                    {[
                        [
                            "One device lost",
                            "Your other devices keep their complete vault. Revoke the lost device’s Online Services permissions. Its local encrypted vault is not remotely erased.",
                        ],
                        [
                            "Every device lost",
                            "Restore a manual encrypted backup, or retrieve your managed backup through Online Services. You still need the required recovery information.",
                        ],
                        [
                            "Cryptex Industries d.o.o. shuts down",
                            "Keep using your local vault, export your data and restore manual backups. The public source code lets you build the software and run your own sync infrastructure. Keep a manual backup independent of Online Services.",
                        ],
                    ].map(([title, text]) => (
                        <article key={title}>
                            <h3>{title}</h3>
                            <p>{text}</p>
                        </article>
                    ))}
                </div>
                <div className={s.phrases}>
                    <strong>Keep both recovery records.</strong>
                    <div className={s.recoveryRecordFlow}>
                        <p>
                            <b>Online Services Recovery Kit</b>
                            <br />
                            Use its User ID and phrase to find available managed
                            backups.
                        </p>
                        <ArrowRight aria-hidden="true" />
                        <p>
                            <b>Vault recovery code</b>
                            <br />
                            Restore access to the vault itself.
                        </p>
                    </div>
                </div>
            </Section>
            <Section>
                <div className={s.trustBlock}>
                    <div>
                        <Label>OPEN SOURCE - AGPL-3.0</Label>
                        <h2>
                            Don’t take
                            <br />
                            our word for it.
                        </h2>
                        <p>
                            Read how the vault works, where its protection ends,
                            and what the infrastructure can observe. Inspect the
                            source code and follow the development on GitHub.
                        </p>
                        <Action href="/security" secondary>
                            Explore security
                        </Action>
                    </div>
                    <div className={s.trustLinks}>
                        {[
                            ["Source code on GitHub", REPO],
                            [
                                "Chromium Extension threat model",
                                "/docs/threat-model",
                            ],
                            [
                                "Chromium Extension architecture",
                                "/docs/architecture",
                            ],
                            [
                                "Responsible disclosure",
                                "/security/responsible-disclosure",
                            ],
                        ].map(([label, href]) => (
                            <Link key={label} href={href!}>
                                {label}
                                <ArrowUpRight size={20} />
                            </Link>
                        ))}
                        <p className={s.audit}>
                            Cryptex Vault has not yet undergone an independent
                            third-party security audit. Internal red-team
                            testing has been performed; independent review is on
                            the roadmap.
                        </p>
                    </div>
                </div>
            </Section>
            <Section>
                <div className={s.sectionHeading}>
                    <h2>
                        Built to be used.
                        <br />
                        Room to go further.
                    </h2>
                    <Link href="/roadmap" className={s.textLink}>
                        View roadmap <ArrowRight size={16} />
                    </Link>
                </div>
                <div className={s.roadmapGrid}>
                    <article>
                        <Label>AVAILABLE NOW</Label>
                        <h3>Your daily vault.</h3>
                        <p>
                            Web app, Chromium Extension, autofill, imports and
                            exports, P2P sync, manual backups and optional
                            managed services.
                        </p>
                    </article>
                    <article>
                        <Label>IN DEVELOPMENT</Label>
                        <h3>Beyond the browser.</h3>
                        <p>
                            Android and granular credential sharing are in
                            development. A Firefox extension is planned.
                        </p>
                    </article>
                    <article>
                        <Label>LOOKING AHEAD</Label>
                        <h3>Follow the work.</h3>
                        <p>
                            Development updates will live on the roadmap. Plans
                            can change as the product and security model evolve.
                        </p>
                    </article>
                </div>
            </Section>
            <Section>
                <div className={s.faqLayout}>
                    <h2>
                        Before you
                        <br />
                        move in.
                    </h2>
                    <div className={s.faq}>
                        {[0, 2, 4, 7].map((index) => (
                            <details key={faqs[index]![0]}>
                                <summary>
                                    {faqs[index]![0]}
                                    <span>+</span>
                                </summary>
                                <p>{faqs[index]![1]}</p>
                            </details>
                        ))}
                        <details className={s.moreQuestions}>
                            <summary>
                                More questions <span>+</span>
                            </summary>
                            <div>
                                {faqs
                                    .filter(
                                        (_, index) =>
                                            ![0, 2, 4, 7].includes(index),
                                    )
                                    .map(([q, a]) => (
                                        <details key={q}>
                                            <summary>
                                                {q}
                                                <span>+</span>
                                            </summary>
                                            <p>{a}</p>
                                        </details>
                                    ))}
                            </div>
                        </details>
                    </div>
                </div>
            </Section>
            <FinalCTA />
        </Site>
    );
}
