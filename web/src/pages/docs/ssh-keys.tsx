import Link from "next/link";

import {
    DocArticle,
    DocCallout,
    DocScreenshot,
    DocSection,
    DocSteps,
} from "@/components/marketing/doc-article";

export default function SSHKeys() {
    return (
        <DocArticle
            title="SSH keys"
            description="Generate, import and save SSH keys stored in your vault."
            toc={[
                { href: "#overview", label: "What an SSH key item holds" },
                { href: "#generate", label: "Generate a key" },
                { href: "#import", label: "Import a key" },
                { href: "#download", label: "Use a key on a computer" },
                { href: "#other-managers", label: "From other managers" },
            ]}
            related={[
                {
                    href: "/docs/ssh-agent",
                    title: "Use keys with the SSH agent",
                },
                {
                    href: "/docs/importing",
                    title: "Import from another password manager",
                },
                {
                    href: "/docs/linking-devices",
                    title: "Link another device",
                },
                { href: "/docs/backups", title: "Back up your vault" },
            ]}
        >
            <DocSection id="overview" title="What an SSH key item holds">
                <p>
                    An SSH key item stores a private key, its public key and a
                    comment, alongside the usual name, folder, notes and tags.
                    The private key is encrypted with the rest of your vault and
                    synchronizes to your linked devices like any other item.
                </p>
                <p>
                    You can create and use SSH key items in the web app, the
                    Chromium Extension and the Android app. New keys are always
                    Ed25519. Imported keys can be Ed25519, ECDSA (P-256, P-384
                    or P-521) or RSA.
                </p>
            </DocSection>

            <DocSection id="generate" title="Generate a key">
                <DocSteps
                    items={[
                        <p key="open">
                            In the web app, choose the arrow next to{" "}
                            <strong>Add New</strong>; in the extension, the
                            arrow next to the add button. Then choose{" "}
                            <strong>SSH key</strong>. On Android, tap the add
                            button and choose <strong>SSH key</strong>.
                        </p>,
                        <p key="mode">
                            Keep <strong>Generate a new key</strong> selected.
                            The public key and fingerprint appear straight away.
                        </p>,
                        <p key="name">
                            Give the key a name. The comment follows the name
                            unless you change it.
                        </p>,
                        <p key="save">Save the item.</p>,
                    ]}
                />
                <DocScreenshot
                    src="/images/docs/ssh-keys-web-new.png"
                    alt="Add SSH key drawer with Generate a new key selected, the new Ed25519 fingerprint and public key, and the name GitHub"
                    caption="Generate a new key is selected by default. Fill in the name and choose Create SSH key."
                    width={1024}
                    height={1800}
                />
                <p>
                    To use the key, copy its public key from the item and add it
                    to the server&apos;s <code>~/.ssh/authorized_keys</code>{" "}
                    file, or to the SSH keys settings of a service such as
                    GitHub or GitLab.
                </p>
            </DocSection>

            <DocSection id="import" title="Import a key">
                <DocSteps
                    items={[
                        <p key="open">
                            Start a new SSH key item and choose{" "}
                            <strong>Use an existing key</strong>.
                        </p>,
                        <p key="paste">
                            Paste the private key, or choose{" "}
                            <strong>Choose file</strong> and pick the key file,
                            for example <code>id_ed25519</code>.
                        </p>,
                        <p key="pub">
                            Optionally, choose <strong>Add .pub file</strong>{" "}
                            and pick the public key file, for example{" "}
                            <code>id_ed25519.pub</code>. It is checked against
                            the private key, and its comment is used if the
                            private key has none. In the extension popup, both
                            buttons first open the vault in a tab, because the
                            popup can close while a file picker is open; choose
                            the files again there.
                        </p>,
                        <p key="passphrase">
                            If the key is protected with a passphrase, enter it
                            and choose <strong>Unlock</strong>.
                        </p>,
                        <p key="save">Check the name and save the item.</p>,
                    ]}
                />
                <p>
                    The passphrase is only used to read the key and is not
                    stored. From then on the key is protected by your vault
                    encryption.
                </p>
                <p>The importer reads these formats:</p>
                <ul>
                    <li>
                        OpenSSH private keys (
                        <code>BEGIN OPENSSH PRIVATE KEY</code>
                        ), with or without a passphrase
                    </li>
                    <li>
                        PEM keys (<code>BEGIN RSA PRIVATE KEY</code>,{" "}
                        <code>BEGIN EC PRIVATE KEY</code>), with or without a
                        passphrase
                    </li>
                    <li>
                        PKCS#8 keys (<code>BEGIN PRIVATE KEY</code> and{" "}
                        <code>BEGIN ENCRYPTED PRIVATE KEY</code>)
                    </li>
                </ul>
                <DocCallout title="Keys that can't be imported">
                    <ul>
                        <li>
                            DSA keys and RSA keys shorter than 1024 bits.
                            OpenSSH no longer accepts them, so generate a new
                            key instead.
                        </li>
                        <li>
                            Keys that live on a hardware security key (types
                            starting with <code>sk-</code>). They can only sign
                            with the security key attached.
                        </li>
                        <li>
                            PuTTY <code>.ppk</code> files. In PuTTYgen, choose{" "}
                            <strong>Conversions</strong> then{" "}
                            <strong>Export OpenSSH key</strong>, and import that
                            file.
                        </li>
                        <li>
                            Keys whose passphrase protection asks for more than
                            1000 bcrypt rounds, which would take too long to
                            unlock. Run{" "}
                            <code>ssh-keygen -p -a 100 -f &lt;file&gt;</code> to
                            re-encrypt the key with fewer rounds.
                        </li>
                        <li>
                            Keys encrypted with ChaCha20-Poly1305 or 3DES. Run{" "}
                            <code>ssh-keygen -p -f &lt;file&gt;</code> to set
                            the passphrase again, which re-encrypts the key in a
                            supported format.
                        </li>
                    </ul>
                </DocCallout>
            </DocSection>

            <DocSection id="download" title="Use a key on a computer">
                <DocScreenshot
                    src="/images/docs/ssh-keys-web-details.png"
                    alt="SSH key item GitHub showing a hidden private key, a Save private key button, then its public key, fingerprint, type Ed25519 and comment"
                    caption="Open the item to save the private key, copy or save the public key, or see its fingerprint."
                    width={768}
                    height={1640}
                />
                <p>
                    Open the item and choose <strong>Save private key</strong>.
                    You can set a passphrase for the file, or leave it blank for
                    an unencrypted file. The file is a standard OpenSSH private
                    key, the same format <code>ssh-keygen</code> writes.{" "}
                    <strong>Save public key</strong> saves the matching{" "}
                    <code>.pub</code> file.
                </p>
                <DocSteps
                    items={[
                        <p key="save">
                            Save the file in <code>~/.ssh</code>, for example as{" "}
                            <code>~/.ssh/id_ed25519</code>.
                        </p>,
                        <p key="chmod">
                            Restrict its permissions with{" "}
                            <code>chmod 600 ~/.ssh/id_ed25519</code>. OpenSSH
                            refuses private keys other users can read.
                        </p>,
                        <p key="check">
                            Check it with{" "}
                            <code>ssh-keygen -y -f ~/.ssh/id_ed25519</code>,
                            which prints the matching public key.
                        </p>,
                    ]}
                />
                <p>
                    You can also reveal and copy the private key from the item,
                    the same way you reveal a password. Every item in the vault
                    stays exportable, and a full vault export includes your SSH
                    keys.
                </p>
                <p>
                    To use a key on a Linux machine without saving it there, use
                    the <Link href="/docs/ssh-agent">SSH agent</Link>. It asks
                    your phone or the web app to approve each signature.
                </p>
                <p>
                    The web app&apos;s security report flags RSA keys shorter
                    than 3072 bits. Replace them with a new Ed25519 key when you
                    can.
                </p>
            </DocSection>

            <DocSection
                id="other-managers"
                title="SSH keys from other password managers"
            >
                <p>
                    SSH key items in Bitwarden and 1Password exports become SSH
                    key items in Cryptex Vault. If a key can&apos;t be read, the
                    import shows a notice and keeps the key text on the item as
                    a hidden field, so nothing is lost. See the{" "}
                    <Link href="/docs/importing">import guide</Link> for the
                    rest of the process.
                </p>
            </DocSection>
        </DocArticle>
    );
}
