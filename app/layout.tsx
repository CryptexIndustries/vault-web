import "../src/styles/globals.css";

export const metadata = {
    title: "CryptexVault - Identity Confirmation",
};

export default function RootLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    return (
        <html lang="en">
            <body className="main min-h-screen">
                <main className="content">{children}</main>
            </body>
        </html>
    );
}
