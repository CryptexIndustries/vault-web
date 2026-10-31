import { plural, t } from "@lingui/core/macro";

import {
    ImportFileError,
    ImportSourceLabels,
    type ImportNotice,
} from "@cryptex-industries/vault-core/vault-utils/import-export";
import { sshKeyErrorText } from "@/utils/ssh-key-messages";

/** The import error to show, in the app language. */
export function importErrorText(error: unknown): string {
    if (!(error instanceof ImportFileError)) {
        return t`Could not parse this export file. Check that the selected source and file match.`;
    }
    const {
        source,
        sourceName,
        row,
        missingColumns,
        reason,
        account,
        vault,
        vaultName,
        folder,
        item,
        itemName,
        field,
        path,
        directoryId,
        fieldPath,
        issue,
    } = error.details;
    const sourceLabel = source ? ImportSourceLabels[source] : "";
    switch (error.code) {
        case "INVALID_JSON":
            if (sourceName === undefined) break;
            return t`${sourceName} export is not valid JSON.`;
        case "INVALID_CSV":
            return row == null
                ? t`${sourceLabel} could not be read as CSV.`
                : t`${sourceLabel} could not be read as CSV near row ${row}.`;
        case "CSV_HEADERS_MISSING":
            return t`${sourceLabel} is missing its header row.`;
        case "CSV_SCHEMA_MISMATCH": {
            if (!missingColumns) {
                return t`KeePass CSV must be either KeePass 1.x CSV (Account, Login Name, Password, Web Site, Comments) or KeePassXC CSV (Group, Title, Username, Password, URL, Notes).`;
            }
            const columns = missingColumns.join(", ");
            const columnCount = missingColumns.length;
            return plural(columnCount, {
                one: `${sourceLabel} is missing required column: ${columns}. Check that the selected source matches the export file.`,
                other: `${sourceLabel} is missing required columns: ${columns}. Check that the selected source matches the export file.`,
            });
        }
        case "BITWARDEN_SCHEMA_MISMATCH":
            return t`This file is not a Bitwarden vault JSON export.`;
        case "ENCRYPTED_EXPORT_UNSUPPORTED":
            return t`Encrypted Bitwarden exports are not supported. Export an unencrypted JSON file from Bitwarden and try again.`;
        case "BITWARDEN_ITEMS_MISSING":
            return t`This file is not a Bitwarden vault JSON export: the items array is missing.`;
        case "BITWARDEN_ITEM_INVALID":
            if (item === undefined) break;
            switch (reason) {
                case "name-or-type":
                    return t`This file can't be imported because Bitwarden item ${item} is missing a valid name or type. Nothing was imported.`;
                case "type-data":
                    return t`This file can't be imported because Bitwarden item ${item} does not contain the data required for its type. Nothing was imported.`;
                case "custom-fields":
                    return t`This file can't be imported because the custom fields on Bitwarden item ${item} are invalid. Nothing was imported.`;
                case "website-addresses":
                    return t`This file can't be imported because the website addresses on Bitwarden item ${item} are invalid. Nothing was imported.`;
            }
            break;
        case "BITWARDEN_FOLDERS_INVALID":
            return t`This file can't be imported because the Bitwarden folders value is invalid. Nothing was imported.`;
        case "BITWARDEN_FOLDER_INVALID":
            if (folder === undefined) break;
            return t`This file can't be imported because Bitwarden folder ${folder} is missing a valid ID or name. Nothing was imported.`;
        case "KEEPASS_ROOT_MISSING":
            return t`KeePass 2.x XML is missing Root > Group.`;
        case "KEEPASS_ENTRY_INVALID":
            if (item === undefined) break;
            if (field == null)
                return t`This file can't be imported because KeePass 1.x item ${item} does not match the documented XML format. Nothing was imported.`;
            if (path === undefined) break;
            return t`This file can't be imported because field ${field} on KeePass item ${item} in "${path}" is invalid. Nothing was imported.`;
        case "INVALID_XML":
            return t`The selected file is not valid XML.`;
        case "KEEPASS_XML_SCHEMA_MISMATCH":
            return t`This is not a KeePass 1.x or KeePass 2.x XML export.`;
        case "INVALID_1PUX":
            return t`The selected file is not a valid 1Password 1PUX archive.`;
        case "ONEPASSWORD_ATTRIBUTES_MISSING":
            return t`The 1PUX archive is missing export.attributes.`;
        case "INVALID_1PUX_ATTRIBUTES":
            return t`The 1PUX export.attributes file is not valid JSON.`;
        case "ONEPASSWORD_ATTRIBUTES_INVALID":
            return t`The 1PUX export.attributes file does not match the supported 1Password format version 3.`;
        case "ONEPASSWORD_DATA_MISSING":
            return t`The 1PUX archive is missing export.data.`;
        case "INVALID_1PUX_DATA":
            return t`The 1PUX export.data file is not valid JSON.`;
        case "ONEPASSWORD_ACCOUNTS_MISSING":
            return t`The 1PUX export is missing its accounts array.`;
        case "ONEPASSWORD_ACCOUNT_INVALID":
            if (account === undefined) break;
            return t`This file can't be imported because 1Password account ${account} is missing its attributes. Nothing was imported.`;
        case "ONEPASSWORD_VAULTS_INVALID":
            if (account === undefined) break;
            return t`This file can't be imported because the vaults in 1Password account ${account} are invalid. Nothing was imported.`;
        case "ONEPASSWORD_VAULT_INVALID":
            if (vault === undefined || account === undefined) break;
            return t`This file can't be imported because 1Password vault ${vault} in account ${account} is missing its name or UUID. Nothing was imported.`;
        case "ONEPASSWORD_ITEMS_INVALID":
            if (vault === undefined) break;
            return t`This file can't be imported because the items in 1Password vault ${vault} are invalid. Nothing was imported.`;
        case "ONEPASSWORD_ITEM_INVALID":
            if (item === undefined || vaultName === undefined) break;
            switch (reason) {
                case "item-structure":
                    return t`This file can't be imported because item ${item} in 1Password vault "${vaultName}" does not match the documented 1PUX item structure. Nothing was imported.`;
                case "item-fields":
                    return t`This file can't be imported because item ${item} in 1Password vault "${vaultName}" contains invalid fields. Nothing was imported.`;
            }
            break;
        case "CRYPTEX_SCHEMA_MISMATCH":
            return t`This is not a current Cryptex Vault JSON export. Expected Directories and Credentials arrays.`;
        case "CRYPTEX_DIRECTORY_INVALID":
            if (folder === undefined) break;
            return t`This file can't be imported because Cryptex Vault folder ${folder} is invalid. Nothing was imported.`;
        case "CRYPTEX_CREDENTIAL_INVALID":
            return item == null
                ? t`A Cryptex Vault credential is missing its name.`
                : t`This file can't be imported because Cryptex Vault item ${item} is invalid. Nothing was imported.`;
        case "IMPORT_DIRECTORY_INVALID":
            if (folder === undefined) break;
            return t`This file can't be imported because folder ${folder} has an invalid name or ID. Nothing was imported.`;
        case "IMPORT_DIRECTORY_ID_DUPLICATE":
            if (directoryId === undefined) break;
            return t`This file can't be imported because more than one folder uses the ID "${directoryId}". Nothing was imported.`;
        case "IMPORT_ITEM_INVALID": {
            if (item === undefined) break;
            const name = itemName || t`Unnamed item`;
            const problem = issue?.message ?? t`unknown error`;
            return fieldPath
                ? t`This file can't be imported because item ${item}, "${name}", has an invalid ${fieldPath}: ${problem}. Nothing was imported.`
                : t`This file can't be imported because item ${item}, "${name}", has an invalid value: ${problem}. Nothing was imported.`;
        }
        case "IMPORT_FILE_TOO_LARGE":
            return t`This file is larger than the 1 GB import limit.`;
        case "UNSUPPORTED_IMPORT_SOURCE":
            return t`The selected import source is not supported.`;
    }
    return error.message;
}

/** A notice's heading with its count, in the app language. */
export function importNoticeHeading(notice: ImportNotice): string {
    const { count } = notice;
    switch (notice.code) {
        case "SSH_KEY_UNSUPPORTED":
        case "CRYPTEX_SSH_KEY_INVALID":
            return plural(count, {
                one: "# Some SSH keys will be saved as hidden fields",
                other: "# Some SSH keys will be saved as hidden fields",
            });
        case "FOLDER_STRUCTURE_ADJUSTED":
            return plural(count, {
                one: "# Folder structure will be adjusted",
                other: "# Folder structure will be adjusted",
            });
        case "URL_SAVED_AS_TEXT":
            return notice.variant === "url-match-rule"
                ? plural(count, {
                      one: "# Website matching settings will be saved as text",
                      other: "# Website matching settings will be saved as text",
                  })
                : plural(count, {
                      one: "# Website addresses will be saved as text",
                      other: "# Website addresses will be saved as text",
                  });
        case "TOTP_CONFIGURATION_UNSUPPORTED":
            return plural(count, {
                one: "# Authenticator setups will be saved as hidden text",
                other: "# Authenticator setups will be saved as hidden text",
            });
        case "BITWARDEN_LINKED_FIELDS_UNSUPPORTED":
            return plural(count, {
                one: "# Bitwarden linked fields can't be recreated",
                other: "# Bitwarden linked fields can't be recreated",
            });
        case "ARCHIVED_STATUS_SAVED_AS_FIELD":
            return plural(count, {
                one: '# Archived status will be saved as an "Archived" checkbox',
                other: '# Archived status will be saved as an "Archived" checkbox',
            });
        case "BITWARDEN_ATTACHMENTS_UNSUPPORTED":
        case "KEEPASS_ATTACHMENTS_UNSUPPORTED":
        case "ONEPASSWORD_ATTACHMENTS_UNSUPPORTED":
            return plural(count, {
                one: "# Attached files can't be carried over",
                other: "# Attached files can't be carried over",
            });
        case "BITWARDEN_PASSKEY_UNSUPPORTED":
            return plural(count, {
                one: "# Some passkeys were saved as custom fields",
                other: "# Some passkeys were saved as custom fields",
            });
        case "BITWARDEN_DELETED_ITEMS_SKIPPED":
        case "KEEPASS_DELETED_ITEMS_SKIPPED":
        case "ONEPASSWORD_DELETED_ITEMS_SKIPPED":
        case "CRYPTEX_DELETED_RECORDS_SKIPPED":
            return plural(count, {
                one: "# Items in the source trash will not be added",
                other: "# Items in the source trash will not be added",
            });
        case "CRYPTEX_DELETED_DIRECTORIES_SKIPPED":
            return plural(count, {
                one: "# Folders in the source trash will not be created",
                other: "# Folders in the source trash will not be created",
            });
        case "KEEPASS_GROUP_METADATA_UNSUPPORTED":
            return plural(count, {
                one: "# Folder notes can't be carried over",
                other: "# Folder notes can't be carried over",
            });
        case "ONEPASSWORD_DOCUMENTS_SKIPPED":
            return plural(count, {
                one: "# Documents whose files are not supported will not be added",
                other: "# Documents whose files are not supported will not be added",
            });
    }
    return `${count} ${notice.title}`;
}

/** A notice's explanation, in the app language. */
export function importNoticeDetail(notice: ImportNotice): string | undefined {
    switch (notice.code) {
        case "SSH_KEY_UNSUPPORTED": {
            const { sourceLabel } = notice;
            const reason =
                notice.sshKeyError && sshKeyErrorText(notice.sshKeyError);
            if (sourceLabel && reason) {
                return t`Cryptex Vault couldn't read these ${sourceLabel} keys, so they can't be used as SSH keys. ${reason}`;
            }
            break;
        }
        case "CRYPTEX_SSH_KEY_INVALID":
            return t`Their key data is damaged, so they can't be used as SSH keys.`;
        case "FOLDER_STRUCTURE_ADJUSTED":
            return t`Nested paths become folder names, long names are shortened, and items whose source folder is missing are added without a folder.`;
        case "URL_SAVED_AS_TEXT":
            return notice.variant === "url-match-rule"
                ? t`Cryptex Vault cannot reproduce these matching rules safely, so they will not be used for autofill.`
                : t`Cryptex Vault cannot use these addresses for autofill.`;
        case "TOTP_CONFIGURATION_UNSUPPORTED":
            switch (notice.variant) {
                case "hotp":
                    return t`Cryptex Vault cannot generate codes from HOTP configurations, so they will be preserved as hidden custom fields.`;
                case "invalid-otp":
                    return t`Cryptex Vault cannot generate codes from invalid or unsupported one-time-password configurations, so they will be preserved as hidden custom fields.`;
                case "invalid-secret":
                    return t`Invalid authenticator secrets will be preserved as hidden custom fields.`;
                case "keepass-settings":
                    return t`Cryptex Vault cannot generate codes from these settings. Missing KeePass settings use KeePass defaults.`;
            }
            break;
        case "BITWARDEN_LINKED_FIELDS_UNSUPPORTED":
            return t`The usernames, passwords, and other values they point to will still be added.`;
        case "BITWARDEN_ATTACHMENTS_UNSUPPORTED":
        case "KEEPASS_ATTACHMENTS_UNSUPPORTED":
        case "ONEPASSWORD_ATTACHMENTS_UNSUPPORTED":
            return t`The rest of each affected item will still be added.`;
        case "BITWARDEN_PASSKEY_UNSUPPORTED":
            return t`Cryptex Vault could not import these as usable passkeys because their key format is unsupported or the item already has an imported passkey.`;
    }
    return notice.detail;
}
