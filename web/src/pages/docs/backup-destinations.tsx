import Link from "next/link";

import {
    DocArticle,
    DocCallout,
    DocScreenshot,
    DocSection,
    DocSteps,
} from "@/components/marketing/doc-article";
import { DocCode } from "@/components/marketing/doc-code";

const policy = `{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["s3:ListBucket"],
      "Resource": "arn:aws:s3:::my-vault-backups"
    },
    {
      "Effect": "Allow",
      "Action": ["s3:PutObject", "s3:GetObject", "s3:DeleteObject"],
      "Resource": "arn:aws:s3:::my-vault-backups/*"
    }
  ]
}`;

const cors = `{
  "CORSRules": [
    {
      "AllowedOrigins": ["https://www.cryptex-vault.com"],
      "AllowedMethods": ["GET", "PUT", "DELETE"],
      "AllowedHeaders": ["*"],
      "MaxAgeSeconds": 3600
    }
  ]
}`;

const putCors = `aws s3api put-bucket-cors --bucket my-vault-backups \\
  --cors-configuration file://cors.json`;

export default function BackupDestinations() {
    return (
        <DocArticle
            title="Backup destinations"
            description="Have every device upload encrypted backups to an S3-compatible bucket you control, and restore from it on a new device."
            toc={[
                { href: "#bucket", label: "Prepare a bucket" },
                { href: "#cors", label: "Allow the web app" },
                { href: "#add", label: "Add a destination" },
                { href: "#uploads", label: "How uploads work" },
                { href: "#restore", label: "Restore from a bucket" },
                { href: "#security-changes", label: "After a password change" },
                { href: "#keys", label: "Where the keys live" },
            ]}
            related={[
                { href: "/docs/backups", title: "Backups" },
                { href: "/docs/recovery", title: "Recovery secrets explained" },
            ]}
        >
            <p>
                A backup destination is a bucket on AWS S3, Backblaze B2,
                Cloudflare R2, Wasabi, MinIO, Garage or any other service that
                speaks the S3 API. After each change to your vault, the web app,
                the Chromium Extension and the Android app upload the same
                encrypted <code>.cryx</code> file you get from{" "}
                <strong>Download backup</strong>. Your devices talk to the
                bucket directly. Our servers never see the bucket or its keys,
                and you don&apos;t need an Online Services account.
            </p>

            <DocSection id="bucket" title="Prepare a bucket">
                <DocSteps
                    items={[
                        <p key="create">
                            Create a bucket for vault backups, such as{" "}
                            <code>my-vault-backups</code>. Keep it private.
                        </p>,
                        <p key="key">
                            Create an access key that can only reach that
                            bucket. Your devices need to list the bucket and
                            write, read and delete objects in it.
                        </p>,
                        <p key="note">
                            Note the endpoint, the region and the key&apos;s ID
                            and secret.
                        </p>,
                    ]}
                />
                <p>On AWS, a policy for that key looks like this:</p>
                <DocCode>{policy}</DocCode>
                <p>
                    If you turn on <strong>Keep every backup</strong>, the key
                    doesn&apos;t need <code>s3:DeleteObject</code>. Old backups
                    then stay until your bucket&apos;s lifecycle rules remove
                    them, and a compromised device can&apos;t delete anything
                    with that key.
                </p>
                <p>
                    MinIO, Garage and most self-hosted servers need path-style
                    addresses, which put the bucket in the path, as in{" "}
                    <code>https://host/bucket</code>. Cloudflare R2 uses the
                    region <code>auto</code>.
                </p>
            </DocSection>

            <DocSection id="cors" title="Allow the web app">
                <p>
                    Browsers block a page from talking to another site unless
                    that site allows it. The web app therefore needs a CORS rule
                    on the bucket. The Chromium Extension and the Android app
                    don&apos;t. Put the address you open the web app from in{" "}
                    <code>AllowedOrigins</code>, without a path. Self-hosters
                    use their own domain.
                </p>
                <DocCode>{cors}</DocCode>
                <p>
                    Save that as <code>cors.json</code> and apply it with the
                    AWS CLI. For other providers, add{" "}
                    <code>--endpoint-url</code> with your endpoint, or set the
                    same rule in the provider&apos;s console.
                </p>
                <DocCode>{putCors}</DocCode>
                <p>
                    Without the rule, the connection test in the web app fails
                    with &quot;Couldn&apos;t reach the bucket&quot;.
                </p>
            </DocSection>

            <DocSection id="add" title="Add a destination">
                <DocSteps
                    items={[
                        <p key="open">
                            Unlock your vault and open{" "}
                            <strong>Backup Center</strong>. On Android it is in{" "}
                            <strong>Settings</strong>.
                        </p>,
                        <p key="add">
                            Under <strong>Your own storage</strong>, choose{" "}
                            <strong>Add destination</strong>.
                        </p>,
                        <p key="fill">
                            Enter a name, the endpoint, the bucket, the region
                            and the access key. Add a folder if the bucket holds
                            other files.
                        </p>,
                        <p key="save">
                            Choose <strong>Test and save</strong>. Cryptex Vault
                            writes, lists and deletes a small test file, then
                            uploads the first backup.
                        </p>,
                    ]}
                />
                <DocScreenshot
                    src="/images/docs/backup-destination-add.png"
                    alt="Add backup destination dialog with endpoint, bucket, region and access key fields"
                    caption="Fill in the bucket details, then choose Test and save."
                    width={1024}
                    height={1620}
                />
                <p>
                    You only add a destination once. It is saved in your vault,
                    so your linked devices get it with the next sync and start
                    uploading too.
                </p>
            </DocSection>

            <DocSection id="uploads" title="How uploads work">
                <p>
                    Each device uploads about 30 seconds after the last change,
                    while the vault is unlocked. If the upload fails, it tries
                    again with growing gaps of up to five minutes. A device
                    uploads anything left over the next time you unlock it.
                    Before the vault locks, it makes one last attempt.
                </p>
                <p>Every device writes to its own folder in the bucket:</p>
                <DocCode>{`<folder>/<destination ID>/<device>/2026-10-26T09-14-03-512Z.cryx`}</DocCode>
                <p>
                    A device uploads only when the vault&apos;s contents
                    changed. After a successful upload, it keeps its backups
                    from the last day, the newest of each day for a month and
                    the newest of each month for a year, the same as managed
                    backups, and deletes its other files. It never touches other
                    devices&apos; folders or files it didn&apos;t write.
                </p>
                <p>
                    Reinstalling the app, clearing the browser&apos;s site data
                    or linking the device again gives it a new folder, and
                    nothing cleans up the old one. Delete old folders in your
                    provider&apos;s console, or add a lifecycle rule that
                    removes files older than 400 days. Unless{" "}
                    <strong>Keep every backup</strong> is on, devices never keep
                    files that old, so the rule only catches abandoned folders.
                </p>
                <DocScreenshot
                    src="/images/docs/backup-destination-center.png"
                    alt="Backup Center showing a backup destination with its last backup time"
                    caption="Each destination shows this device's last backup. The switch pauses uploads on every device."
                    width={1692}
                    height={496}
                />
                <p>
                    Use <strong>Back up now</strong> to upload straight away.
                    The switch pauses a destination for all your devices.
                    Removing a destination stops the uploads but leaves the
                    files in the bucket.
                </p>
            </DocSection>

            <DocSection id="restore" title="Restore from a bucket">
                <DocSteps
                    items={[
                        <p key="tab">
                            Open <Link href="/app">Cryptex Vault</Link> and
                            select the <strong>Restore</strong> tab. Choose{" "}
                            <strong>Restore from your own S3 storage</strong>.
                            On Android, choose <strong>Your own storage</strong>{" "}
                            as the backup source.
                        </p>,
                        <p key="details">
                            Enter the same endpoint, bucket, region, folder and
                            access key as on your devices, then choose{" "}
                            <strong>Find backups</strong>.
                        </p>,
                        <p key="pick">
                            Pick a backup. The list shows the newest first, with
                            the device that made each one.
                        </p>,
                        <p key="unlock">
                            Name the restored vault, choose{" "}
                            <strong>Restore Vault</strong>, and unlock it with
                            its master password or vault recovery code.
                        </p>,
                    ]}
                />
                <DocScreenshot
                    src="/images/docs/backup-destination-restore.png"
                    alt="Restore tab listing backups found in a bucket"
                    caption="Find backups lists every backup under the folder. Pick one to restore it as a new vault."
                    width={768}
                    height={1410}
                />
                <p>
                    The restored vault still has the destination, so it starts
                    uploading again under a new device folder.
                </p>
            </DocSection>

            <DocSection id="security-changes" title="After a password change">
                <p>
                    Changing the master password, the additional key protection
                    or the recovery code uploads a new backup to every
                    destination right away. Older backups still open with the
                    old secrets. To remove them, turn on{" "}
                    <strong>
                        Delete older destination backups after replacement
                    </strong>{" "}
                    when you save the change. Each destination then deletes this
                    device&apos;s older backups once the new one has uploaded
                    there. Other devices have their own master passwords, so
                    their backups stay.
                </p>
                <DocScreenshot
                    src="/images/docs/backup-destination-security.png"
                    alt="Key change options with Delete older destination backups after replacement turned on"
                    caption="The option appears under the key change options once the vault has a backup destination."
                    width={1068}
                    height={488}
                />
            </DocSection>

            <DocSection id="keys" title="Where the keys live">
                <p>
                    The bucket keys are stored inside your encrypted vault. They
                    sync to your linked devices and are part of every backup and
                    export. Anyone holding the keys can download your backup
                    files, but can&apos;t open them without your vault secrets.
                </p>
                <DocCallout
                    title="Keep a way to open the backups"
                    tone="warning"
                >
                    <p>
                        You need the bucket keys to find the backups and your
                        vault secrets to open them. Store the access key
                        somewhere outside the vault too, next to your{" "}
                        <Link href="/docs/recovery">recovery code</Link>.
                        Otherwise a lost device can leave you with backups you
                        can&apos;t reach.
                    </p>
                </DocCallout>
            </DocSection>
        </DocArticle>
    );
}
