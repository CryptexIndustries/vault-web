import { useEffect, useState } from "react";
import t from "@/styles/TechnicalDocs.module.css";

export function DocCode({ children }: { children: string }) {
    const [status, setStatus] = useState<"idle" | "copied" | "failed">("idle");
    useEffect(() => setStatus("idle"), [children]);
    useEffect(() => {
        if (status === "idle") return;
        const timer = setTimeout(() => setStatus("idle"), 3000);
        return () => clearTimeout(timer);
    }, [status]);
    return (
        <div className="my-[22px] min-w-0 border border-[var(--line)] bg-[rgba(0,0,0,0.18)]">
            <div
                className={`${t.commandToolbar} flex flex-nowrap items-center gap-2 border-b border-[var(--line)] px-[10px] py-1 text-[11px] leading-4 text-[var(--soft)]`}
            >
                <span>Shell</span>
                <button
                    type="button"
                    aria-label="Copy code"
                    title={
                        status === "failed"
                            ? "Copy failed. Select the code to copy manually."
                            : "Copy code"
                    }
                    onClick={async () => {
                        try {
                            await navigator.clipboard.writeText(children);
                            setStatus("copied");
                        } catch {
                            setStatus("failed");
                        }
                    }}
                >
                    {status === "copied"
                        ? "Copied"
                        : status === "failed"
                          ? "Retry"
                          : "Copy"}
                </button>
                <span role="status" className="sr-only">
                    {status === "copied"
                        ? "Copied"
                        : status === "failed"
                          ? "Copy failed. Select the code to copy manually."
                          : ""}
                </span>
            </div>
            <pre
                className={`${t.numberedCode} m-0 overflow-x-auto pb-[14px] pl-0 pr-4 pt-[14px] text-[var(--ink)]`}
                aria-label="Shell commands"
            >
                <code>
                    {children.split("\n").map((line, index) => (
                        <span className="inline" key={index}>
                            <span
                                className="inline-block w-[3.5em] select-none pr-[1em] text-right text-[var(--soft)] opacity-[.65]"
                                aria-hidden="true"
                            >
                                {index + 1}
                            </span>
                            <span
                                className={
                                    line.trimStart().startsWith("#")
                                        ? t.commandComment
                                        : undefined
                                }
                            >
                                {line || " "}
                            </span>
                            {index < children.split("\n").length - 1
                                ? "\n"
                                : ""}
                        </span>
                    ))}
                </code>
            </pre>
        </div>
    );
}
