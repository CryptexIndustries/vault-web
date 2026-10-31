/** Starts the e2e Garage for the backup destination tests and stops it after. */
import { startGarage } from "../../e2e/garage/garage";

export default function globalSetup() {
    // The live job only runs the Autofill.me spec.
    if (process.env.CRYPTEX_LIVE_E2E === "1") return;
    return startGarage("cryptex-vault-e2e-extension");
}
