import { BuiltInProviderType } from "next-auth/providers";
import {
    ClientSafeProvider,
    getProviders,
    LiteralUnion,
} from "next-auth/react";
import { useRouter } from "next/router";
import { useState } from "react";
import NavBar from "../components/index/navbar";
import LoginModal from "../components/login/loginModal";

type IndexProps = {
    providers: Record<
        LiteralUnion<BuiltInProviderType, string>,
        ClientSafeProvider
    > | null;
};

const index: React.FC<IndexProps> = ({ providers }) => {
    const { query } = useRouter();

    const [loginModalVisible, setLoginModalVisible] = useState(
        query.signIn === "true" ? true : false
    );
    const showLoginModal = () => setLoginModalVisible(true);
    const hideLoginModal = () => setLoginModalVisible(false);

    return (
        <>
            <NavBar showLoginModalFn={showLoginModal} />

            <div className="content">
                <h1>Buy our awesome product!</h1>
            </div>

            <LoginModal
                visible={loginModalVisible}
                hideModalFn={hideLoginModal}
                providers={providers}
            />
        </>
    );
};

export async function getServerSideProps() {
    const providers = await getProviders();
    return {
        props: {
            providers,
        },
    };
}

export default index;
