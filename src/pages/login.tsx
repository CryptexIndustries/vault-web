import { useSession } from "next-auth/react";

const LoginPage = () => {
    const session = useSession();

    if (session.data) {
        return <div>Already logged in</div>;
    } else {
        return (
            <div>
                <h1>Please authenticate</h1>
            </div>
        );
    }
};

export default LoginPage;
