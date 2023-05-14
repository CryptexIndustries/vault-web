export type PageFooterProps = {
    children?: React.ReactNode;
};

const PageFooter: React.FC<PageFooterProps> = ({ children }) => {
    return (
        <footer className="bg-gray-900 pb-5 px-2 flex flex-col items-center w-full">
            {children}
            <div className="text-center mt-4">
                <h1 className="text-sm text-gray-400">
                    Made with ❤️ by the team at Cryptex Vault.
                </h1>
                <h1 className="text-sm text-gray-400">
                    All rights reserved. © {new Date().getFullYear()} Cryptex
                    Vault
                </h1>
            </div>
        </footer>
    );
};

export default PageFooter;
