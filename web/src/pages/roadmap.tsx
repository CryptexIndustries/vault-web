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

// Update this list when priorities, targets or progress change.
const roadmap = [
    {
        title: "In progress",
        label: "ACTIVE DEVELOPMENT",
        items: [
            {
                title: "Android application v1.0.0",
                target: "1.5.0",
                description: "Use Cryptex Vault on Android.",
            },
            {
                title: "Credential sharing via a URL",
                target: "1.6.0",
                description:
                    "Share a credential through a link, even with someone who does not use Cryptex Vault.",
            },
        ],
    },
    {
        title: "Planned",
        label: "UPCOMING WORK",
        items: [
            {
                title: "Advanced Security Report",
                target: "1.7.0",
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
];

export default function Roadmap() {
    return (
        <Site
            title="Roadmap"
            description="Active development and planned features for Cryptex Vault, with target versions."
        >
            <section className={s.pageHero}>
                <Label>PRODUCT DEVELOPMENT</Label>
                <h1>Roadmap</h1>
                <p>
                    What we are building and what is planned next. Version
                    targets may change.
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
                                        {item.target
                                            ? `Target v${item.target}`
                                            : "Version not set"}
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
            <Section number="03" label="FEEDBACK" className={r.group}>
                <h2>Have a suggestion?</h2>
                <p>Tell us what you would like to see in GitHub Discussions.</p>
                <Action href={`${REPO}/discussions`} secondary>
                    Join the discussion
                </Action>
            </Section>
        </Site>
    );
}
