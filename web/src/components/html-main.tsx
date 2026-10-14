import { useEffect } from "react";

export type HTMLMainProps = {
    additionalClasses?: string;
    children?: React.ReactNode;
};

const HTMLMain: React.FC<HTMLMainProps> = ({ additionalClasses, children }) => {
    const _additionalClasses = additionalClasses ?? "";

    // Dialogs, popovers and menus portal into <body>, outside <main>, so they
    // need the theme class there too.
    useEffect(() => {
        document.body.classList.add("dark");
        return () => document.body.classList.remove("dark");
    }, []);

    return (
        <main className={"dark min-h-svh bg-background " + _additionalClasses}>
            {children}
        </main>
    );
};

export default HTMLMain;
