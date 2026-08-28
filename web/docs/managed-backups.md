# Managed encrypted backups

The Backup Center brings manual and managed backups together in one place. It
opens from **Backups** in the dashboard sidebar, directly below **Security
Report**.

A manual backup downloads an encrypted `.cryx` file to the user's device.
Managed backups use the same portable format, but upload restore points to
Cryptex Vault Online Services automatically. Managed backups are a Premium feature;
manual backups remain available without them.

## What Cryptex Vault Online Services stores

The browser creates and encrypts every backup before sending anything to the
backup service. The backup copy leaves out linked-device and sync configuration,
but keeps the Online Services device binding inside the encrypted vault. That
binding is needed when a restored vault signs back in.

Cryptex Vault Online Services receives encrypted bytes, their size, and a SHA-256 checksum. It never
receives the vault password, vault recovery code, additional protection key,
DEK, or plaintext vault contents.

An upload happens in three steps:

1. The client asks for a short-lived object-storage URL
2. The client uploads the encrypted `.cryx` bytes directly
3. The service verifies the ciphertext size and SHA-256 checksum

The UI deployment must set `NEXT_PUBLIC_BACKUP_STORAGE_ORIGIN` to the exact
origin used by signed transfer URLs. The Content Security Policy permits backup
transfers only to that object-storage origin.

## When automatic backups run

Managed backups run only while the web vault is open and unlocked. A successful
vault change marks the backup as dirty. Changes made close together are grouped
for 30 seconds so a short editing session does not upload a new restore point
after every click.

Failed uploads retry while the unlocked session remains available. The user can
also choose **Backup Now** to upload a restore point immediately.

When the vault locks, a final upload attempt gets up to five seconds to finish.
The vault still locks when that time expires. Closing the browser, losing power,
or terminating the device cannot guarantee one last upload.

## What the Backup Center status means

The sidebar shows whether managed backups are on or off and the age and source
of the latest known backup. The Backup Center gives the fuller explanation.

For a manual download, the browser stores a small receipt in `localStorage`.
The receipt is encrypted and authenticated with the active vault DEK and bound
to that vault's ID. Data placed into `localStorage` by something else cannot
create a trusted backup date without passing AES-GCM authentication.

The receipt also contains a fingerprint of the saved encrypted vault state used
to create the download. After the vault changes, the old receipt stays visible
with its original date, but the UI updates to say that there have been changes
since that backup. It does not pretend the older file contains newer edits.

A local receipt proves that Cryptex Vault initiated a download for that vault state.
It cannot prove that the browser finished writing the file or that the user
still has it.

Managed-backup history works a little differently. The service reports when
the latest restore point became ready. If managed backups are paused, that
historical date remains useful and stays visible, but it is not treated as proof
that the current vault is covered. The UI only says backup coverage is current
when managed backups are active or the most recent known backup is a local
download whose receipt matches the current vault exactly.

The age reminder is deliberately limited. It appears only when all of the
following are true:

- The account has confirmed Premium entitlement
- Managed backups are off
- No backup exists, or the latest known backup is at least 30 days old

Free and signed-out users are not warned to make a backup.

## Enabling and managing backups

Only the root device can enable managed backups. Before enabling them, the user
must create and save an Online Services Recovery Kit in **Account > Security**.
The Backup Center explains the recovery requirements in an application dialog
before enabling the feature.

Pausing managed backups stops automatic uploads but keeps existing restore
points available for download. A root device can delete one restore point or
delete them all. Both actions use an explicit in-app confirmation dialog.
Deleting all restore points also pauses managed backups and removes the cloud
history needed for fresh-device recovery.

## Account recovery protection

The account recovery status answers a practical question: if this browser or
device is lost, can someone with the Online Services Recovery Kit find an
encrypted restore point that can restore account access?

The backup API returns `accountRecoveryProtection` with one of four values:

- `none` means there is no eligible restore point
- `pending` means backups are configured, but the first current-root backup is
  not ready (uploaded) yet
- `protected` means at least one ready restore point from the current root
  device is available
- `degraded` means recovery is configured, but the current root device no
  longer has a ready restore point that recovery can use

The managed-backup card displays these as **Unavailable**, **Pending first root
backup**, **Protected**, and **Degraded**. `protected` is the only affirmative
state for fresh-device account recovery.

The signed-in restore-point list also includes a `sourceLabel`: **Root device**,
**Linked device**, or **Removed device**. This label describes where a backup
came from. It does not mean every listed restore point is eligible for
fresh-device recovery. That recovery flow exposes only restore points from the
current root device.

## Restoring from a backup file

The **Vault Manager > Restore** tab accepts an encrypted `.cryx` file without
requiring an unlocked vault:

1. Open **Restore** in the Vault Manager
2. Drop a `.cryx` file into the restore area or browse for one
3. Give the restored vault a name and optional description
4. Choose **Restore Vault**
5. Select the new vault in the **Unlock** tab
6. Unlock it with its vault password or recovery code and any required second
   factor

Restoring creates a new local vault; it does not overwrite an existing one. If
the backup contains an Online Services binding, the dashboard can sign in with
that binding after the vault is unlocked.

## Restoring on a fresh device

Fresh-device recovery is for a new browser or device where no local vault can
be unlocked. It starts from **Vault Manager > Restore** and requires two
separate proofs:

1. The Online Services User ID, Recovery Kit phrase, and captcha prove control
   of the Online Services account and allow the browser to find eligible
   restore points
2. The vault password or recovery code, plus any configured additional
   protection key, decrypts the selected vault locally

The Recovery Kit can find the encrypted backup but cannot decrypt it. The vault
secret can decrypt the backup but cannot find the account's cloud restore
points. Both are required.

### Recovery steps

1. Open the app without unlocking a vault and select **Restore**
2. Choose **No file? Use Managed Backups (Online Services)**
3. Enter the Online Services User ID and Recovery Kit phrase
4. Complete the captcha and choose **Find Root Restore Points**
5. Select a restore point; the newest eligible one is recommended
6. Give the restored vault a name and optional description
7. Choose **Restore Vault**
8. Unlock the restored vault with its password or recovery code and any
   configured additional protection key

The browser checks the encrypted download's size and checksum before using it as
the selected backup. It does not decrypt the vault during that step.
The restored copy becomes a new local vault and never overwrites an existing
vault automatically.

## Recovery Kit lifecycle

The Recovery Kit is consumed only after its credentials are accepted and at
least one eligible current-root restore point is available. If no eligible
restore point exists, the Kit is not consumed.

If listing or downloading fails after authorization, the page keeps the recovery
session so the user can retry. If the authorization response itself is
interrupted, the retained session still needs a fresh single-use captcha before
retrying. Once the session is confirmed, listing retries do not require another
captcha.

The first unlock after a successful fresh-device restore requests a replacement
Recovery Kit. When generation succeeds, the user must save, print, or copy it
before dismissing the dialog. If generation fails, it can be retried from
**Account > Security** or on the next unlock.

The server exposes this requirement as `recoveryGenerationNeeded` in the
authenticated `user.configuration` response. After the replacement Kit is
saved, the normal signed-in backup UI can list and download the account's
retained restore points again.

## Recommended setup

To prepare for losing a device:

1. Create and save an Online Services Recovery Kit in **Account > Security**
2. Open **Backups** from the dashboard sidebar
3. Enable managed backups from the root device
4. Keep the vault open and unlocked until the first root backup finishes
5. Confirm that account recovery shows **Protected**

If the status remains **Pending first root backup**, no restore point is ready
for fresh-device recovery yet. If it becomes **Degraded**, check the backup
error and let the current root device complete a new backup.

## Troubleshooting restores

- **No root restore points are found:** Managed backups may not have been
  enabled, the first root backup may still be pending, or all eligible restore
  points may have been deleted.
- **The cloud download succeeds but the vault will not unlock:** Cloud recovery
  authorizes access to the encrypted backup; it does not replace the vault
  password, recovery code, or additional protection key.
