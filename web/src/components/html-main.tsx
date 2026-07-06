export type HTMLMainProps = {
    additionalClasses?: string;
    children?: React.ReactNode;
};

const HTMLMain: React.FC<HTMLMainProps> = ({ additionalClasses, children }) => {
    const _additionalClasses = additionalClasses ?? "";
    return (
        <main
            className={"dark min-h-screen bg-background " + _additionalClasses}
        >
            {children}
        </main>
    );
};

export default HTMLMain;
