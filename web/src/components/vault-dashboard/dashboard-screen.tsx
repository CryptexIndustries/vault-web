import { useId, type ReactNode, type Ref } from "react";
import { ArrowLeft, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";

/** Shared by the header and the content so they line up. */
export const SCREEN_COLUMN = "mx-auto w-full max-w-4xl px-4 sm:px-6 lg:px-8";

/**
 * A full-screen dashboard view with a fixed header. With `scroll` off, the
 * children must fill the rest (`min-h-0 flex-1`) and scroll themselves.
 */
export function DashboardScreen({
    icon: Icon,
    title,
    description,
    onBack,
    actions,
    toolbar,
    scroll = true,
    scrollerRef,
    testId,
    children,
}: {
    icon: LucideIcon;
    title: string;
    description?: string;
    onBack: () => void;
    actions?: ReactNode;
    /** A second header row, such as search and filters. */
    toolbar?: ReactNode;
    scroll?: boolean;
    scrollerRef?: Ref<HTMLDivElement>;
    testId?: string;
    children: ReactNode;
}) {
    const titleId = useId();
    return (
        <main
            aria-labelledby={titleId}
            data-testid={testId}
            className="relative z-10 flex min-h-0 min-w-0 flex-1 flex-col bg-background text-foreground shadow-2xl"
        >
            <div className="shrink-0 border-b border-border">
                <div className={`${SCREEN_COLUMN} space-y-3 py-3 lg:pt-6`}>
                    <div className="flex items-center gap-3">
                        <Button
                            variant="ghost"
                            size="icon"
                            className="-ml-2 shrink-0"
                            aria-label="Back to credentials"
                            title="Back to credentials"
                            onClick={onBack}
                        >
                            <ArrowLeft className="h-4 w-4" />
                        </Button>
                        <div className="hidden h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-primary/20 bg-primary/10 sm:flex">
                            <Icon className="h-4 w-4 text-primary" />
                        </div>
                        <div className="min-w-0 flex-1">
                            <h1
                                id={titleId}
                                className="truncate text-lg font-semibold"
                            >
                                {title}
                            </h1>
                            {description ? (
                                // Only where there's height to spare.
                                <p className="hidden text-sm text-muted-foreground [@media(min-height:700px)]:block">
                                    {description}
                                </p>
                            ) : null}
                        </div>
                        {actions ? (
                            <div className="flex shrink-0 items-center gap-2">
                                {actions}
                            </div>
                        ) : null}
                    </div>
                    {toolbar}
                </div>
            </div>
            {scroll ? (
                <ScrollArea
                    className="min-h-0 flex-1"
                    viewportRef={scrollerRef}
                >
                    <div className={`${SCREEN_COLUMN} py-5`}>{children}</div>
                </ScrollArea>
            ) : (
                children
            )}
        </main>
    );
}
