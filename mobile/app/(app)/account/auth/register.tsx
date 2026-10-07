import { Redirect } from "expo-router";

export default function AccountRegisterScreen() {
    return (
        <Redirect
            href={{
                pathname: "/(app)/(tabs)/account",
                params: { signup: "1" },
            }}
        />
    );
}
