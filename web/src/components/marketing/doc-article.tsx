import Link from "next/link";
import Image from "next/image";
import type { ReactNode } from "react";
import { ArrowLeft, ArrowRight } from "lucide-react";

import { Label, Site } from "@/components/marketing/site";
import d from "@/styles/Docs.module.css";

export type DocLink = {
    href: string;
    title: string;
    description?: string;
};

export function DocArticle({
    title,
    description,
    eyebrow = "USER GUIDE",
    toc = [],
    related = [],
    children,
}: {
    title: string;
    description: string;
    eyebrow?: string;
    toc?: { href: string; label: string }[];
    related?: DocLink[];
    children: ReactNode;
}) {
    return (
        <Site title={title} description={description}>
            <header
                className={`${d.hero} border-b border-[var(--line)] px-[5%] pb-16 pt-[70px] max-[760px]:pt-12`}
            >
                <Link
                    href="/docs"
                    className="mb-[45px] inline-flex items-center gap-2 text-[12px] text-[var(--soft)] hover:text-[var(--coral)] max-[760px]:mb-8"
                >
                    <ArrowLeft size={15} aria-hidden="true" /> All guides
                </Link>
                <Label>{eyebrow}</Label>
                <h1>{title}</h1>
                <p>{description}</p>
            </header>
            <div className="grid grid-cols-[minmax(170px,230px)_minmax(0,760px)] justify-center gap-[clamp(55px,8vw,120px)] px-[5%] pb-[100px] pt-[70px] max-[760px]:block max-[760px]:pb-[70px] max-[760px]:pt-[45px]">
                {toc.length ? (
                    <aside
                        className={`${d.toc} sticky top-7 flex flex-col self-start border-t border-[var(--line)] pt-5 max-[760px]:static max-[760px]:mb-[55px]`}
                        aria-label="On this page"
                    >
                        <p>ON THIS PAGE</p>
                        {toc.map((item) => (
                            <a key={item.href} href={item.href}>
                                {item.label}
                            </a>
                        ))}
                    </aside>
                ) : null}
                <article className="min-w-0">{children}</article>
            </div>
            {related.length ? (
                <section
                    className={`${d.related} border-t border-[var(--line)] px-[5%] pb-[90px] pt-[70px]`}
                    aria-labelledby="related-guides"
                >
                    <p className={d.kicker}>KEEP READING</p>
                    <h2 id="related-guides">Related guides</h2>
                    <div className={d.cardGrid}>
                        {related.map((item) => (
                            <DocCard key={item.href} {...item} />
                        ))}
                    </div>
                </section>
            ) : null}
        </Site>
    );
}

export function DocSection({
    id,
    title,
    kicker,
    children,
}: {
    id?: string;
    title: string;
    kicker?: string;
    children: ReactNode;
}) {
    return (
        <section
            id={id}
            className={`${d.docSection} mb-[58px] border-b border-[var(--line)] pb-[58px]`}
        >
            {kicker ? <p className={d.kicker}>{kicker}</p> : null}
            <h2>{title}</h2>
            {children}
        </section>
    );
}

export function DocSteps({ items }: { items: ReactNode[] }) {
    return (
        <ol
            className={`${d.steps} my-7 list-none border-t border-[var(--line)] p-0`}
        >
            {items.map((item, index) => (
                <li key={index}>
                    <span>{String(index + 1).padStart(2, "0")}</span>
                    <div>{item}</div>
                </li>
            ))}
        </ol>
    );
}

export function DocCallout({
    title,
    tone = "note",
    children,
}: {
    title: string;
    tone?: "note" | "warning";
    children: ReactNode;
}) {
    return (
        <aside
            className={`${d.callout} my-7 border-l-[3px] border-[var(--coral)] px-6 py-[22px] ${tone === "warning" ? "bg-[rgba(255,86,104,0.08)]" : "bg-[rgba(252,248,236,0.04)]"}`}
        >
            <strong>{title}</strong>
            <div>{children}</div>
        </aside>
    );
}

export function DocCard({ href, title, description }: DocLink) {
    return (
        <Link
            href={href}
            className={`${d.card} flex min-h-[120px] items-center justify-between gap-[25px] border border-[var(--line)] p-[26px] hover:border-[var(--coral)]`}
        >
            <span>
                <strong>{title}</strong>
                {description ? <small>{description}</small> : null}
            </span>
            <ArrowRight size={18} aria-hidden="true" />
        </Link>
    );
}

export function DocsGrid({ children }: { children: ReactNode }) {
    return <div className={d.cardGrid}>{children}</div>;
}

export { d as docsStyles };

export function DocScreenshot({
    src,
    alt,
    caption,
    width = 2880,
    height = 1800,
}: {
    src: string;
    alt: string;
    caption: string;
    width?: number;
    height?: number;
}) {
    return (
        <figure className={`${d.screenshot} my-7 min-w-0`}>
            <a
                href={src}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`View full-size screenshot: ${alt} (opens in a new tab)`}
            >
                <Image
                    src={src}
                    alt={alt}
                    width={width}
                    height={height}
                    unoptimized
                />
                <span>
                    View full size <ArrowRight size={14} aria-hidden="true" />
                </span>
            </a>
            <figcaption>{caption}</figcaption>
        </figure>
    );
}
