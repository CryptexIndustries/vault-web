import { IncomingMessage, ServerResponse } from "http";
import { GetServerSideProps, GetServerSidePropsContext } from "next";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { getServerAuthSession } from "../server/common/get-server-auth-session";

const accountPage = () => {
    const session = useSession();

    if (!session.data) {
        return null;
    }

    return (
        <>
            <h1>Account Administration</h1>
            <p>
                Signed in as {session.data.user?.name} (
                {session.data.user?.email}) ID: {session.data.user?.id}
            </p>
            <p> Session expires at {session.data.expires}</p>
            <Link href="/api/auth/signout">
                <a className="bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded">
                    Sign out
                </a>
            </Link>
        </>
    );
};

export const getServerSideProps = async (ctx: GetServerSidePropsContext) => {
    const session = await getServerAuthSession(ctx);

    return {
        props: {
            session,
        },
    };
};

export default accountPage;
