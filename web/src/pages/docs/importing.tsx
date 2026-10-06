import Link from "next/link";
import { useState } from "react";

import {
    DocArticle,
    DocScreenshot,
    DocCallout,
    DocSection,
    DocSteps,
    docsStyles,
} from "@/components/marketing/doc-article";

export default function Importing() {
    const [entryPoint, setEntryPoint] = useState<"create" | "settings">(
        "create",
    );
    return (
        <DocArticle
            title="Importing passwords"
            description="Bring an export into a new or existing vault, then check the fields you depend on before switching over."
            toc={[
                { href: "#formats", label: "Supported formats" },
                { href: "#import", label: "Run the import" },
                { href: "#check", label: "Check the result" },
                { href: "#migrate", label: "Migrate safely" },
            ]}
            related={[
                { href: "/docs/getting-started", title: "Getting started" },
                { href: "/docs/backups", title: "Back up the imported vault" },
            ]}
        >
            <DocSection id="formats" title="Choose the matching export">
                <p>
                    Choose the format that matches your export. The limits below
                    describe what Cryptex Vault can import from each file.
                </p>
                <ul className={docsStyles.formatList}>
                    <li>
                        <strong>Cryptex Vault JSON</strong>
                        <p>
                            Imports credentials and directories. Deleted items
                            are skipped. This is a data import, not a full vault
                            restore; use the{" "}
                            <Link href="/docs/backups">backup guide</Link> for
                            encrypted .cryx files.
                        </p>
                    </li>
                    <li>
                        <strong>Bitwarden JSON</strong>
                        <p>
                            Requires a JSON export that is not encrypted.
                            Attachments and linked custom fields are not
                            imported. Supported ECDSA P-256 passkeys can be
                            imported, one per item. Unsupported or extra
                            passkeys are saved as custom fields, not usable
                            passkeys. Unsupported URL matching rules are also
                            saved as text, not used for autofill. Card details
                            and password history become custom fields;
                            organization and collection IDs are copied as text,
                            not sharing permissions.
                        </p>
                    </li>
                    <li>
                        <strong>1Password 1PUX</strong>
                        <p>
                            Documents, attachments, and deleted items are not
                            imported. Archived items are included with an
                            Archived checkbox. Imports multiple URLs, supported
                            one-time codes, and section fields. Password history
                            and other field values are preserved as custom
                            fields; their original behavior may not carry over.
                            Passkeys are not imported as usable passkeys.
                        </p>
                    </li>
                    <li>
                        <strong>1Password CSV</strong>
                        <p>
                            Imports recognized login columns, notes, tags, and
                            TOTP when present. Extra columns become text custom
                            fields, and archived status becomes a checkbox.
                            Documents and attachments are not imported. Use 1PUX
                            for multiple URLs, vault folders, and richer item
                            data.
                        </p>
                    </li>
                    <li>
                        <strong>KeePass XML</strong>
                        <p>
                            Imports entries, group paths, text custom fields,
                            and supported TOTP secrets. KeePass 2 XML entry
                            history is saved as custom fields, not a browsable
                            history. Attachments are not imported. Export XML
                            first; encrypted KDBX files are not accepted.
                        </p>
                    </li>
                    <li>
                        <strong>KeePass CSV</strong>
                        <p>
                            Accepts KeePass 1.x and KeePassXC CSV exports.
                            Imports login details, notes, supported TOTP, and
                            groups when present. Extra columns become text
                            custom fields. Attachments and entry history are not
                            carried in this format; use XML for richer item
                            data.
                        </p>
                    </li>
                    <li>
                        <strong>LastPass CSV</strong>
                        <p>
                            Imports recognized login columns, notes, and
                            grouping as directories. Recognized structured
                            secure notes become the matching item type with
                            custom fields. Extra CSV columns are preserved as
                            text. Attachments are not imported.
                        </p>
                    </li>
                    <li>
                        <strong>Chrome CSV</strong>
                        <p>
                            Imports saved login details and notes when present.
                            Passkeys, payment methods, and addresses are not
                            imported. Each entry uses a single website URL.
                        </p>
                    </li>
                    <li>
                        <strong>Firefox CSV</strong>
                        <p>
                            Imports saved login details. Browser-specific form
                            matching information is saved as custom fields, not
                            applied as autofill rules. Passkeys are not
                            imported. Each entry uses a single website URL.
                        </p>
                    </li>
                </ul>
                <DocCallout title="The export is readable text" tone="warning">
                    <p>
                        Most password-manager and browser exports are not
                        encrypted (cleartext). Export and import on a trusted
                        device. Delete the plaintext file after you have checked
                        the new vault and made an encrypted backup.
                    </p>
                </DocCallout>
            </DocSection>

            <DocSection id="import" title="Run the import">
                <p>
                    These steps and screenshots show the Cryptex Vault web
                    application.
                </p>
                <div
                    className={docsStyles.platformSelector}
                    role="group"
                    aria-label="Import entry point"
                >
                    <button
                        type="button"
                        aria-pressed={entryPoint === "create"}
                        aria-controls="import-entry-point"
                        onClick={() => setEntryPoint("create")}
                    >
                        New vault
                    </button>
                    <button
                        type="button"
                        aria-pressed={entryPoint === "settings"}
                        aria-controls="import-entry-point"
                        onClick={() => setEntryPoint("settings")}
                    >
                        Unlocked vault
                    </button>
                </div>
                <div id="import-entry-point">
                    {entryPoint === "create" ? (
                        <p>
                            On the <strong>Create</strong> tab, find{" "}
                            <strong>Import existing passwords</strong> and
                            choose <strong>Import</strong>. You can review the
                            import before creating the vault.
                        </p>
                    ) : (
                        <p>
                            In your unlocked vault, open{" "}
                            <strong>Vault Settings</strong>, find{" "}
                            <strong>Import</strong>, and choose{" "}
                            <strong>Import Passwords</strong>.
                        </p>
                    )}
                    <DocScreenshot
                        key={entryPoint}
                        src={
                            entryPoint === "create"
                                ? "/images/docs/import-create.png"
                                : "/images/docs/import-settings.png"
                        }
                        width={entryPoint === "create" ? 500 : 1024}
                        height={entryPoint === "create" ? 930 : 880}
                        alt={
                            entryPoint === "create"
                                ? "Create tab with the Import button under Import existing passwords"
                                : "Vault Settings with the Import Passwords button"
                        }
                        caption={
                            entryPoint === "create"
                                ? "Import is optional during vault creation. Choose your export before selecting Create Vault."
                                : "Import Passwords adds items to the unlocked vault. Existing items are kept."
                        }
                    />
                </div>
                <DocSteps
                    items={[
                        <p key="source">
                            Select the source and format that produced the
                            export.
                        </p>,
                        <p key="file">
                            Choose the export file. Cryptex Vault parses it
                            locally.
                        </p>,
                        <p key="review">
                            Review <strong>Before you import</strong>: items
                            found, items that will or will not be added, and
                            folders that will be created. Check the lists of
                            skipped items, information saved differently, and
                            information that cannot be carried over.
                        </p>,
                        <p key="confirm">
                            If asked, confirm that you understand the listed
                            omissions and changes. Choose{" "}
                            <strong>Import</strong> only when you are ready to
                            accept them.
                        </p>,
                    ]}
                />
                <p>
                    Import adds credentials to the vault. It does not use
                    matching titles to replace existing credentials, so
                    importing the same file again can create duplicates.
                </p>
                <p>
                    Files must be no larger than 1 GB and match the selected
                    export format. If validation fails, nothing is imported.
                    Export again from the source app rather than renaming
                    columns to make an unrelated file fit.
                </p>
            </DocSection>

            <DocSection id="check" title="Check what arrived">
                <p>
                    Open a sample from every important folder or account type.
                    Check the username, password, primary URL, extra URLs,
                    notes, custom fields, and TOTP where you use them. Warnings
                    may point to fields or item types that could not be carried
                    over. For example, 1Password attachments and documents are
                    not imported.
                </p>
                <p>
                    Try a few logins manually before setting up the{" "}
                    <Link href="/docs/browser-extension">
                        {" "}
                        Chromium Extension
                    </Link>
                    . A successful item count alone does not prove every field
                    maps the way you expect.
                </p>
                <DocScreenshot
                    src="/images/walkthrough/credential.png"
                    alt="Credential detail panel showing the imported fields"
                    caption="Check representative entries in the detail panel, including the website used for autofill."
                />
            </DocSection>

            <DocSection id="migrate" title="Use a trial vault first">
                <p>
                    Keep the source password manager and its original data.
                    Import into a separate Cryptex Vault, check representative
                    entries, and download a <code>.cryx</code> backup. Only then
                    decide whether to make Cryptex Vault your primary copy.
                </p>
                <p>
                    If you need to leave later, <strong>Vault Settings</strong>{" "}
                    can export Cryptex Vault JSON. That JSON is also plaintext
                    and needs the same careful handling.
                </p>
            </DocSection>
        </DocArticle>
    );
}
