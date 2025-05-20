export type HTMLMainProps = {
    additionalClasses?: string;
    children?: React.ReactNode;
};

const HTMLMain: React.FC<HTMLMainProps> = ({ additionalClasses, children }) => {
    const _additionalClasses = additionalClasses ?? "";
    return (
        <main className={"main dark min-h-screen " + _additionalClasses}>
            {children}
        </main>
    );
};

export default HTMLMain;
