import { expect, it, jest } from "@jest/globals";
import AccountDevicesScreen from "../app/(app)/account/devices/index";

jest.mock("expo-router", () => ({ Redirect: "Redirect" }));

it("opens the same device controls from the account route", () => {
    const screen = AccountDevicesScreen();
    expect(screen.type).toBe("Redirect");
    expect(screen.props.href).toBe("/(app)/(tabs)/devices");
});
