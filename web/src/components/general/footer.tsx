export type PageFooterProps = {
    children?: React.ReactNode;
};

const PageFooter: React.FC<PageFooterProps> = ({ children }) => {
    return (
        <footer className="flex w-full flex-col items-center bg-gray-900 px-2 pb-5">
            {children}
            <div className="mt-4 text-center">
                <h1 className="text-sm text-gray-400">
                    All rights reserved. © {new Date().getFullYear()} Cryptex
                    Industries
                </h1>
            </div>
        </footer>
    );
};

export default PageFooter;
