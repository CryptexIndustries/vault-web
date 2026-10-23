import Link from "next/link";

import {
    Site,
    Label,
    Section,
    Action,
    REPO,
    s,
} from "@/components/marketing/site";
import r from "@/styles/Roadmap.module.css";

// Update this list when priorities, targets or progress change. Targets are
// quarters, such as "Q4 2026".
const roadmap = [
    {
        title: "In progress",
        label: "ACTIVE DEVELOPMENT",
        available: false,
        items: [
            {
                title: "Android application v1.0.0",
                target: "Q4 2026",
                description: "Use Cryptex Vault on Android.",
            },
        ],
    },
    {
        title: "Planned",
        label: "UPCOMING WORK",
        available: false,
        items: [
            {
                title: "Advanced Security Report",
                target: "Q1 2027",
                description:
                    "Scan dark web data dumps and alert you to exposed credentials.",
            },
            {
                title: "Custom backup destinations",
                target: null,
                description:
                    "Store backups on your own infrastructure or in commercial S3-compatible buckets.",
            },
            {
                title: "Firefox extension",
                target: null,
                description:
                    "Use the Cryptex Vault browser extension in Firefox.",
            },
            {
                title: "Granular device-linking permissions",
                target: null,
                description:
                    "More control over permissions when linking devices.",
            },
            {
                title: "iOS application",
                target: null,
                description: "Use Cryptex Vault on iOS.",
            },
        ],
    },
    {
        title: "Available",
        label: "BUILT AND AVAILABLE",
        available: true,
        items: [
            {
                title: "SSH agent",
                target: null,
                description:
                    "Keep SSH keys in your vault and use them on Linux. The agent stores no keys on the machine. Your phone or the web app approves each signature.",
            },
            {
                title: "Android application",
                target: null,
                description:
                    "Use Cryptex Vault on Android. Install it from our F-Droid repository or download the APK from GitHub. Google Play and the main F-Droid repository are reviewing it.",
            },
            {
                title: "One-time share links",
                target: null,
                description:
                    "Send a credential or any text through a link that opens once, even to someone who doesn't use Cryptex Vault. Self-hosters can run their own share server.",
            },
        ],
    },
];

export default function Roadmap() {
    return (
        <Site
            title="Roadmap"
            description="Active development and planned features for Cryptex Vault, with target dates."
        >
            <section className={s.pageHero}>
                <Label>PRODUCT DEVELOPMENT</Label>
                <h1>Roadmap</h1>
                <p>
                    What we are building, what is planned next and what recently
                    became available. Target dates may change.
                </p>
                <p className={r.changelog}>
                    <Link href="/changelog">View changelog</Link>
                </p>
            </section>
            {roadmap.map((group, index) => (
                <Section
                    key={group.title}
                    number={String(index + 1).padStart(2, "0")}
                    label={group.label}
                    className={r.group}
                >
                    <h2>{group.title}</h2>
                    <ul className="m-0 max-w-[950px] list-none p-0">
                        {group.items.map((item) => (
                            <li
                                key={item.title}
                                className="border-b border-[var(--line)] py-6 first:pt-0 last:border-b-0 last:pb-0"
                            >
                                <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2.5 max-[640px]:flex-col max-[640px]:items-start">
                                    <h3>{item.title}</h3>
                                    <span className="shrink-0 font-[monospace] text-[12px] text-[var(--coral)]">
                                        {group.available
                                            ? "Available"
                                            : item.target
                                              ? `Target ${item.target}`
                                              : "Date not set"}
                                    </span>
                                </div>
                                <p className="mt-2.5 max-w-[800px]">
                                    {item.description}
                                </p>
                            </li>
                        ))}
                    </ul>
                </Section>
            ))}
            <Section
                number={String(roadmap.length + 1).padStart(2, "0")}
                label="FEEDBACK"
                className={r.group}
            >
                <h2>Have a suggestion?</h2>
                <p>Tell us what you would like to see in GitHub Discussions.</p>
                <Action href={`${REPO}/discussions`} secondary>
                    Join the discussion
                </Action>
            </Section>
        </Site>
    );
}
