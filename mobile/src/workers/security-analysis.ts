// Bundled as plain JavaScript for the isolated Hermes worker, not imported by RN.
import "fast-text-encoding";
import { URL } from "whatwg-url-minimum";
import { iterateCredentialSecurityAnalysis } from "@cryptex-industries/vault-core/vault-utils/security-report";

Object.assign(globalThis, { URL, iterateCredentialSecurityAnalysis });
