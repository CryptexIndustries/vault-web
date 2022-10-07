// Example of a restricted endpoint that only authenticated users can access from https://next-auth.js.org/getting-started/example

import { NextApiRequest, NextApiResponse } from "next";
import { getServerAuthSession } from "../../server/common/get-server-auth-session";

const restricted = async (req: NextApiRequest, res: NextApiResponse) => {
    const session = await getServerAuthSession({ req, res });

    if (session) {
        res.send({
            content: `Signed in as ${session.user?.name} (${session.user?.email}) session expires at ${session.expires}`,
        });
    } else {
        res.send({
            error: "You must be signed in to view the protected content on this page.",
        });
    }
};

export default restricted;
