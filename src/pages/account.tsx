import { IncomingMessage, ServerResponse } from "http";
import { GetServerSideProps, GetServerSidePropsContext } from "next";
import { useSession } from "next-auth/react";
import { getServerAuthSession } from "../server/common/get-server-auth-session";

const accountPage = () => {
    const session = useSession();

    if (!session.data) {
        return null;
    }

    return (
        <div>
            <h1>Account Page</h1>
            <p>User ID: {session.data.user?.id}</p>
        </div>
    );
};

export const getServerSideProps = async (ctx: GetServerSidePropsContext) => {
    const session = await getServerAuthSession(ctx);

    if (!session) {
        return {
            redirect: {
                destination: "/login",
                permanent: false,
            },
        };
    }
};

export default accountPage;
