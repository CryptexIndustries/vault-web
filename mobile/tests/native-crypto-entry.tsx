import "../src/polyfills";
import "../src/vault-core-runtime";
import { registerRootComponent } from "expo";
import { useEffect, useState } from "react";
import { Text } from "react-native";
import { runNativeCryptoTests } from "./native-crypto-suite";

function CryptoTests() {
    const [status, setStatus] = useState("Native crypto and WebRTC tests running");
    useEffect(() => {
        void runNativeCryptoTests()
            .then((result) => {
                console.info(`CRYPTEX_CRYPTO_RESULT ${JSON.stringify(result)}`);
                setStatus("Native crypto and WebRTC tests passed");
            })
            .catch((error: unknown) => {
                console.error(`CRYPTEX_CRYPTO_FAILURE ${String(error)}`);
                setStatus("Native crypto and WebRTC tests failed");
            });
    }, []);
    return <Text>{status}</Text>;
}

registerRootComponent(CryptoTests);
