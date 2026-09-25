import { NextPage } from "next/types";
import Link from "next/link";

import HTMLHeader from "@/components/html-header";
import HTMLMain from "@/components/html-main";
import NavBar from "@/components/navbar";

const SecurityPolicy: NextPage = () => {
    return (
        <>
            <HTMLHeader
                title="Cryptex Vault - Responsible Disclosure Policy"
                description="How to report security issues in Cryptex Vault."
            />

            <HTMLMain>
                <NavBar />

                <div className="content">
                    <div className="mt-0 flex w-full flex-col items-center px-5 text-slate-200 md:mt-10 md:px-0">
                        <h1 className="text-4xl font-bold">
                            Responsible Disclosure Policy
                        </h1>
                        <div className="mb-5 max-w-2xl">
                            <p className="pt-6 text-justify">
                                Cryptex Industries d.o.o. welcomes responsible
                                reports of security issues in Cryptex Vault. At
                                the moment we do not offer a paid bug bounty,
                                but we will do our best to thank researchers and
                                credit them when a fix ships.
                            </p>

                            <h2 className="mt-10 text-2xl font-bold">
                                1. How to report
                            </h2>
                            <p className="pt-2 text-justify">
                                Email{" "}
                                <a
                                    href="mailto:security@cryptex-vault.com"
                                    className="font-bold underline"
                                >
                                    security@cryptex-vault.com
                                </a>
                                . Do not open a public GitHub issue for security
                                vulnerabilities.
                            </p>
                            <p className="pt-2 text-justify">
                                Prefer encrypted mail. Download our{" "}
                                <Link
                                    href="/security/publickey.security@cryptex-vault.com.asc"
                                    className="font-bold underline"
                                >
                                    PGP public key
                                </Link>
                                . Fingerprint:
                            </p>
                            <p className="break-all pt-2 font-mono text-sm">
                                732E 0452 ECFC 9975 43D0 5469 3D03 FF8D 6356
                                96EA
                            </p>
                            <p className="pt-2 text-justify">
                                You should receive a first response within 3
                                working days.
                            </p>

                            <h2 className="mt-10 text-2xl font-bold">
                                2. What to include
                            </h2>
                            <ul className="list-disc pl-5 pt-2 text-justify">
                                <li className="pt-1">
                                    Short summary of the issue and its impact
                                </li>
                                <li className="pt-1">
                                    Affected product or surface (web app,
                                    extension, desktop client, API, or
                                    infrastructure) and version or commit if
                                    known
                                </li>
                                <li className="pt-1">
                                    Step-by-step reproduction with your own test
                                    accounts and data only
                                </li>
                                <li className="pt-1">
                                    Proof of concept (commands, screenshots, or
                                    a minimal patch) sufficient to verify the
                                    issue
                                </li>
                                <li className="pt-1">
                                    Any suggested fix (optional)
                                </li>
                                <li className="pt-1">
                                    How you want to be credited when a fix ships
                                    (name, handle, or anonymous)
                                </li>
                            </ul>

                            <h2 className="mt-10 text-2xl font-bold">
                                3. Scope
                            </h2>
                            <p className="pt-2 text-justify">
                                In scope: Cryptex Vault web application, browser
                                extensions, desktop clients, APIs, and
                                infrastructure operated by Cryptex Industries
                                d.o.o.
                            </p>
                            <p className="pt-2 text-justify">
                                Out of scope (non-exhaustive):
                            </p>
                            <ul className="list-disc pl-5 pt-2 text-justify">
                                <li className="pt-1">
                                    Social engineering, phishing, or physical
                                    attacks
                                </li>
                                <li className="pt-1">
                                    Denial of service, volumetric flooding, or
                                    resource exhaustion without a distinct
                                    security flaw
                                </li>
                                <li className="pt-1">
                                    Issues in third-party services we rely on
                                    (for example Stripe, email providers, CDNs,
                                    browsers, or operating systems) unless
                                    Cryptex Vault misuses them in a way that
                                    creates a clear vulnerability
                                </li>
                                <li className="pt-1">
                                    Findings that require prior access to an
                                    unlocked device or already-decrypted vault
                                    data with no further bypass
                                </li>
                                <li className="pt-1">
                                    Automated scanner output without a working
                                    proof of concept
                                </li>
                                <li className="pt-1">
                                    Missing recommended security headers or
                                    other hardening suggestions that do not
                                    demonstrate a real vulnerability
                                </li>
                            </ul>

                            <h2 className="mt-10 text-2xl font-bold">
                                4. Rules of engagement
                            </h2>
                            <ul className="list-disc pl-5 pt-2 text-justify">
                                <li className="pt-1">
                                    Use only accounts and vault data you own or
                                    create for testing
                                </li>
                                <li className="pt-1">
                                    Do not access, modify, or exfiltrate other
                                    users&apos; data
                                </li>
                                <li className="pt-1">
                                    Do not degrade service availability for
                                    others
                                </li>
                                <li className="pt-1">
                                    Stop and report promptly if you encounter
                                    sensitive data that is not yours
                                </li>
                                <li className="pt-1">
                                    Keep vulnerability details private until
                                    coordinated disclosure (see below)
                                </li>
                            </ul>

                            <h2 className="mt-10 text-2xl font-bold">
                                5. Safe harbor
                            </h2>
                            <p className="pt-2 text-justify">
                                If you make a good-faith effort to follow this
                                policy, Cryptex Industries d.o.o. will not
                                pursue legal action against you for researching
                                or reporting a security issue covered by this
                                policy. We consider such research authorized
                                under applicable anti-hacking laws to the extent
                                the activity stays within these rules.
                            </p>
                            <p className="pt-2 text-justify">
                                Safe harbor does not cover activity outside this
                                policy, intentional harm, privacy violations, or
                                extortion.
                            </p>

                            <h2 className="mt-10 text-2xl font-bold">
                                6. Disclosure timeline
                            </h2>
                            <p className="pt-2 text-justify">
                                Please wait before public disclosure. We aim to
                                fix issues as quickly as we can. Unless we agree
                                otherwise, you may disclose 30 days after your
                                initial report, or earlier once we confirm a fix
                                is available.
                            </p>

                            <h2 className="mt-10 text-2xl font-bold">
                                7. Recognition
                            </h2>
                            <p className="pt-2 text-justify">
                                At the moment there is no monetary reward. When
                                a valid issue is fixed, we will credit the
                                reporter as a thank you for their efforts unless
                                they ask to remain anonymous. Duplicate or
                                out-of-scope reports may receive a short reply
                                or none beyond acknowledgment.
                            </p>

                            <h2 className="mt-10 text-2xl font-bold">
                                8. Contact
                            </h2>
                            <p className="pt-2 text-justify">
                                Cryptex Industries d.o.o.
                                <br />
                                <a
                                    href="mailto:security@cryptex-vault.com"
                                    className="font-bold underline"
                                >
                                    security@cryptex-vault.com
                                </a>
                            </p>
                            <p className="pt-4 text-sm text-slate-400">
                                Also see our{" "}
                                <Link
                                    href="/privacy"
                                    className="font-bold underline"
                                >
                                    Privacy Policy
                                </Link>{" "}
                                and{" "}
                                <Link
                                    href="/terms"
                                    className="font-bold underline"
                                >
                                    Terms of Service
                                </Link>
                                .
                            </p>
                        </div>
                    </div>
                </div>
            </HTMLMain>
        </>
    );
};

export default SecurityPolicy;
