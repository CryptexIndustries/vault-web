import Link from "next/link";

import {
    DocArticle,
    DocCallout,
    DocScreenshot,
    DocSection,
    DocSteps,
} from "@/components/marketing/doc-article";
import { DocCode } from "@/components/marketing/doc-code";

const install = `# The version you picked on the releases page, and amd64 or arm64
VERSION=REPLACE_WITH_VERSION
ARCH=amd64
NAME=cryptex-agent-$VERSION-linux-$ARCH
BASE=https://github.com/CryptexIndustries/vault-web/releases/download/cryptex-agent-v$VERSION
curl --fail --location --remote-name "$BASE/$NAME.tar.gz"
curl --fail --location --remote-name "$BASE/sha256sums.txt"
# Stop here unless this prints OK
sha256sum --check --ignore-missing sha256sums.txt
tar -xzf "$NAME.tar.gz"
sudo install -Dm755 "$NAME/cryptex-agent" /usr/bin/cryptex-agent
sudo install -Dm644 "$NAME/cryptex-agent.service" /usr/lib/systemd/user/cryptex-agent.service`;

const run = `# Start the agent now and at every login
systemctl --user enable --now cryptex-agent
# Point SSH at it; add this line to ~/.bashrc or ~/.zshrc too
export SSH_AUTH_SOCK=$XDG_RUNTIME_DIR/cryptex-agent.sock
# Lists the keys you granted, even offline
ssh-add -L
cryptex-agent status`;

const gitSigning = `git config --global gpg.format ssh
# Paste the public key from the SSH key item, after key::
git config --global user.signingkey "key::ssh-ed25519 AAAAC3Nza... GitHub"
git commit -S -m "Signed commit"
# Optional: sign every commit
git config --global commit.gpgsign true`;

export default function SSHAgent() {
    return (
        <DocArticle
            title="SSH agent"
            description="Use the SSH keys in your vault on a Linux machine without copying them there. Your phone or the web app approves each signature."
            toc={[
                { href: "#overview", label: "How it works" },
                { href: "#install", label: "Install the agent" },
                { href: "#pair", label: "Pair it with your vault" },
                { href: "#use", label: "Use it with ssh and git" },
                { href: "#approve", label: "Approve requests" },
                { href: "#manage", label: "Manage and revoke" },
                { href: "#relay", label: "The relay" },
                { href: "#troubleshooting", label: "Troubleshooting" },
            ]}
            related={[
                { href: "/docs/ssh-keys", title: "SSH keys" },
                {
                    href: "/docs/linking-devices",
                    title: "Link another device",
                },
                { href: "/docs/self-hosting", title: "Self-hosting" },
            ]}
        >
            <DocSection id="overview" title="How it works">
                <p>
                    <code>cryptex-agent</code> is an SSH agent for Linux that
                    holds no private keys. When <code>ssh</code>,{" "}
                    <code>git</code> or <code>ssh-keygen</code> asks it to sign,
                    it sends the request to the device you paired it with: the
                    Android app or the web app. You approve there, your vault
                    signs, and only the signature goes back to the machine.
                </p>
                <p>
                    The private key never reaches the Linux machine, so malware
                    on that machine can&apos;t copy it. The worst it can do is
                    ask for a signature, and you see each request with the
                    server, the program and the key before anything is signed.
                </p>
                <p>
                    Requests travel through a relay, either the hosted one that
                    comes with Online Services or one you run yourself. They are
                    end-to-end encrypted between the agent and your device. The
                    relay sees which agent talks to which device, when and how
                    much, and nothing else.
                </p>
                <p>
                    You need an <Link href="/docs/ssh-keys">SSH key item</Link>{" "}
                    in your vault, and the agent needs a Linux machine with
                    systemd. Release builds exist for amd64 and arm64.
                </p>
            </DocSection>

            <DocSection id="install" title="Install the agent">
                <p>
                    Download a release tarball from the{" "}
                    <a href="https://github.com/CryptexIndustries/vault-web/releases">
                        GitHub releases
                    </a>
                    . Agent releases are tagged <code>cryptex-agent-v</code>{" "}
                    followed by the version. An AUR package for Arch Linux,{" "}
                    <code>cryptex-agent-bin</code>, will follow.
                </p>
                <DocCode>{install}</DocCode>
                <p>
                    To install without root, copy the binary to{" "}
                    <code>~/.local/bin</code> and the unit file to{" "}
                    <code>~/.config/systemd/user/</code>, then change the
                    unit&apos;s <code>ExecStart=</code> line to{" "}
                    <code>%h/.local/bin/cryptex-agent run</code>.
                </p>
            </DocSection>

            <DocSection id="pair" title="Pair it with your vault">
                <p>
                    Pairing tells the agent which device approves its requests
                    and which keys it may ask for. Run this on the Linux
                    machine:
                </p>
                <DocCode>{`cryptex-agent pair`}</DocCode>
                <p>
                    It prints a QR code and, under it, a text code starting with{" "}
                    <code>cryptex-pair:</code>. The code works for three
                    minutes. If it expires, press Enter in the terminal for a
                    new one. On a light terminal background, use{" "}
                    <code>cryptex-agent pair --invert</code> so the QR code
                    scans.
                </p>
                <h3>With the Android app</h3>
                <DocSteps
                    items={[
                        <p key="open">
                            Open the <strong>Devices</strong> tab, tap{" "}
                            <strong>+</strong> next to the search field, and
                            choose <strong>Connect an agent</strong>.
                        </p>,
                        <p key="scan">
                            Point the camera at the QR code. If the camera
                            can&apos;t read it, tap <strong>Paste code</strong>{" "}
                            and paste the text code.
                        </p>,
                        <p key="keys">
                            Give the agent a name and pick the keys it may use
                            under <strong>Keys this agent can use</strong>, or
                            none and add them later with{" "}
                            <strong>Edit keys</strong>. With many keys, search
                            the list or use <strong>Select all</strong>. Then
                            tap <strong>Connect</strong>. On Android 13 and
                            later, the phone asks whether Cryptex Vault may send
                            notifications. Allow it, or requests that arrive
                            while the app is closed or locked can&apos;t reach
                            you.
                        </p>,
                        <p key="code">
                            The phone shows a short code such as{" "}
                            <code>CP22-34W6</code>. Check that the terminal
                            shows the same one, and press Enter there.
                        </p>,
                    ]}
                />
                <DocScreenshot
                    src="/images/docs/ssh-agent-android-add.png"
                    alt="Android Devices tab with the Add sheet open, listing Create invitation, Use invitation and Connect an agent"
                    caption="On the Devices tab, tap + next to the search field, then Connect an agent."
                    width={720}
                    height={1404}
                />
                <DocScreenshot
                    src="/images/docs/ssh-agent-android-keys.png"
                    alt="Android Connect an agent screen showing the machine work-laptop, Linux amd64, the name work-laptop and two selected keys, GitHub and Deploy, above a Connect button"
                    caption="Tap each key the agent may use, then Connect. The machine line is what the machine reports about itself."
                    width={720}
                    height={1404}
                />
                <DocScreenshot
                    src="/images/docs/ssh-agent-android-code.png"
                    alt="Android Check the code screen with a confirmation code, Waiting for the agent and a Cancel button"
                    caption="Compare this code with the terminal on work-laptop, then press Enter there."
                    width={720}
                    height={1404}
                />
                <h3>With the web app</h3>
                <DocSteps
                    items={[
                        <p key="open">
                            Unlock your vault. In the sidebar, under{" "}
                            <strong>Linked Devices</strong>, find{" "}
                            <strong>Connected Agents</strong> and choose{" "}
                            <strong>+</strong>.
                        </p>,
                        <p key="paste">
                            Paste the text code from the terminal and choose{" "}
                            <strong>Continue</strong>.
                        </p>,
                        <p key="keys">
                            Give the agent a name, pick its keys and choose{" "}
                            <strong>Connect</strong>. With many keys, search the
                            list or use <strong>Select all</strong>. You can
                            also connect with no keys and add them later with{" "}
                            <strong>Edit keys</strong>.
                        </p>,
                        <p key="code">
                            Check that the terminal shows the same code as the
                            browser, and press Enter there.
                        </p>,
                    ]}
                />
                <DocScreenshot
                    src="/images/docs/ssh-agent-web-sidebar.png"
                    alt="Vault dashboard with the Connected Agents heading in the sidebar under Linked Devices, with a gear and a + button"
                    caption="Connected Agents sits in the sidebar under Linked Devices. Choose + to connect an agent. The gear opens Agent relays."
                    width={2880}
                    height={1800}
                />
                <DocScreenshot
                    src="/images/docs/ssh-agent-web-connect-code.png"
                    alt="Connect an agent dialog with a pasted cryptex-pair code and a Continue button"
                    caption="Paste the code that cryptex-agent pair printed, then choose Continue."
                    width={1024}
                    height={658}
                />
                <DocScreenshot
                    src="/images/docs/ssh-agent-web-connect-keys.png"
                    alt="Connect an agent dialog showing the machine work-laptop, Linux amd64, a Name field and two selected SSH keys, GitHub and Deploy"
                    caption="Name the agent and tick the keys it may use, then choose Connect. The machine line is what the machine reports about itself."
                    width={1024}
                    height={1127}
                />
                <DocScreenshot
                    src="/images/docs/ssh-agent-web-connect-confirm.png"
                    alt="Check the code dialog showing a confirmation code and Waiting for the agent"
                    caption="Compare this code with the terminal, then press Enter in the terminal. Once the save starts, Cancel shows Saving…"
                    width={1024}
                    height={607}
                />
                <p>
                    When you connect your first agent, the browser asks whether
                    Cryptex Vault may show notifications. Allow it to hear about
                    requests while the tab is in the background.
                </p>
                <DocCallout title="If the codes don't match" tone="warning">
                    <p>
                        Someone else answered the QR code first. Press Ctrl-C in
                        the terminal; the agent removes that pairing again.
                        Nothing is saved on the machine until you press Enter.
                    </p>
                </DocCallout>
                <p>
                    After you press Enter, your device saves the agent in your
                    vault. From then on <strong>Cancel</strong> shows{" "}
                    <strong>Saving…</strong> and can&apos;t be pressed until the
                    save is done.
                </p>
                <p>
                    The device you pair with becomes the agent&apos;s approver.
                    Only that device answers its requests. Your other linked
                    devices see the agent and its history, and can revoke it.
                </p>
                <p>
                    The agent uses the hosted relay unless you pass{" "}
                    <code>--relay</code>. For a relay you run yourself, use{" "}
                    <code>
                        cryptex-agent pair --relay https://relay.example.com
                    </code>
                    . The app or browser then asks for the relay&apos;s access
                    token and saves it in your vault for that device. See{" "}
                    <a href="#relay">the relay</a> below.
                </p>
            </DocSection>

            <DocSection id="use" title="Use it with ssh and git">
                <p>
                    Start the service and point SSH at the agent&apos;s socket:
                </p>
                <DocCode>{run}</DocCode>
                <p>
                    <code>ssh-add -L</code> should print the public keys you
                    granted. From then on, <code>ssh</code>, <code>scp</code>,{" "}
                    <code>git push</code> and anything else that uses{" "}
                    <code>SSH_AUTH_SOCK</code> asks your device to approve each
                    login. Each request waits up to 90 seconds. If it isn&apos;t
                    answered within a few seconds and <code>notify-send</code>{" "}
                    is installed, the machine shows a desktop notification as a
                    reminder.
                </p>
                <p>
                    The agent logs each request it is waiting on, and how it
                    ended, in <code>journalctl --user -u cryptex-agent</code>.
                    To also see a line in the terminal that made the request,
                    for example on a server without a desktop, set{" "}
                    <code>terminal = true</code> in{" "}
                    <code>~/.config/cryptex-agent/config</code>.
                </p>
                <p>
                    Some desktops set <code>SSH_AUTH_SOCK</code> to their own
                    agent after your shell starts. To make <code>ssh</code> use
                    this agent whatever the variable says, add{" "}
                    <code>
                        IdentityAgent
                        $&#123;XDG_RUNTIME_DIR&#125;/cryptex-agent.sock
                    </code>{" "}
                    under <code>Host *</code> in <code>~/.ssh/config</code>.
                </p>
                <p>
                    With several keys granted, the agent offers the key that
                    last worked with a server first, so you approve one request
                    per login.
                </p>
                <h3>Sign git commits</h3>
                <p>
                    Git can sign commits with an SSH key. Copy the public key
                    from the SSH key item in your vault, or from{" "}
                    <code>ssh-add -L</code>, and set it as the signing key:
                </p>
                <DocCode>{gitSigning}</DocCode>
                <p>
                    Each signature asks for approval like a login does. For
                    GitHub or GitLab to show commits as verified, add the same
                    public key there as a signing key.
                </p>
                <p>
                    The agent can&apos;t add, remove or lock keys, because it
                    has none. <code>ssh-add</code> with a key file,{" "}
                    <code>ssh-add -d</code>, <code>ssh-add -D</code> and{" "}
                    <code>ssh-add -x</code> are refused.
                </p>
            </DocSection>

            <DocSection id="approve" title="Approve requests">
                <p>
                    A request shows a question such as{" "}
                    <strong>Sign in to github.com?</strong> and these details:
                </p>
                <ul>
                    <li>
                        <strong>Agent</strong>: the name you gave the machine.
                    </li>
                    <li>
                        <strong>Server</strong> and <strong>Host key</strong>:
                        where you are logging in.
                    </li>
                    <li>
                        <strong>User</strong>: the account on the server.
                    </li>
                    <li>
                        <strong>Key</strong>: the vault item that will sign.
                    </li>
                    <li>
                        <strong>Process</strong>: the command that asked, such
                        as <code>git push</code>, and its process ID.
                    </li>
                </ul>
                <p>
                    The process and the machine name come from the machine
                    itself. Treat them as a hint, because malware on the machine
                    could fake them.
                </p>
                <p>
                    When several requests wait, the prompt shows which one you
                    are looking at, such as <strong>1 of 3</strong>, and moves
                    on to the next after each answer. <strong>Approve</strong>{" "}
                    can&apos;t be used for about 0.7 seconds after a request
                    appears, so a tap or key press meant for something else
                    can&apos;t approve it. In the web app, the prompt never
                    opens with <strong>Approve</strong> focused, so pressing
                    Enter can&apos;t approve it either.
                </p>
                <DocScreenshot
                    src="/images/docs/ssh-agent-web-request.png"
                    alt="Request dialog titled Sign in to git.example.com with 1 of 2 waiting, agent work-laptop, user git, a verified host key, the GitHub key, the process git push origin main, Remember choices, Pause agent, Deny and Approve"
                    caption="A login request in the web app. The host key is verified, and the server name matches one you approved before. Pause agent at the bottom stops all requests from this agent."
                    width={1024}
                    height={1574}
                />
                <h3>Verified servers</h3>
                <p>
                    OpenSSH 8.9 and later tell the agent which server they are
                    logging in to, signed by that server&apos;s host key. Your
                    device checks that signature itself and marks the host key{" "}
                    <strong>verified</strong>. The server name comes from the
                    machine&apos;s <code>known_hosts</code> file, so it is only
                    what the machine reports.
                </p>
                <p>
                    Each agent remembers the server name it showed for each host
                    key when you approved a login yourself. These names sync
                    with the agent to your other devices. When the name and host
                    key match one you approved before, the server line says{" "}
                    <strong>
                        You approved this name for this host key before
                    </strong>
                    . Otherwise it says{" "}
                    <strong>Name reported by the machine, not verified</strong>.
                    The prompt warns when a known host key comes with a new
                    name, or a known name with a new host key. Approve those
                    only if you expected the change, for example after the
                    server was reinstalled.
                </p>
                <DocScreenshot
                    src="/images/docs/ssh-agent-web-host-warning.png"
                    alt="Request dialog for deploy.example.com with a warning that the machine now calls this server deploy.example.com and before it was git.example.com"
                    caption="The same host key arrived under a new name. Deny unless you renamed the server yourself."
                    width={1024}
                    height={1684}
                />
                <h3>Destination unknown</h3>
                <p>
                    Some clients don&apos;t say which server they log in to:
                    OpenSSH before 8.9, Paramiko and therefore Ansible, libssh2,
                    and programs written in Go. Their requests show{" "}
                    <strong>SSH login, destination unknown</strong>.{" "}
                    <strong>Deny</strong> is the default button, the other
                    choice is <strong>Approve once</strong>, and these requests
                    are never remembered. Approve one only if you started that
                    login yourself a moment ago.
                </p>
                <h3>Agent forwarding</h3>
                <p>
                    Forwarding works: after <code>ssh -A</code> to a jump host,
                    logins from there to other servers still ask your device. A
                    forwarded request carries a warning and a{" "}
                    <strong>Via</strong> line naming the jump host. It means a
                    server you are logged in to is asking to use your key, so
                    approve it only if you expect it. Forwarded requests are
                    never remembered.
                </p>
                <h3>Signatures</h3>
                <p>
                    Commit signing shows <strong>Sign a git commit?</strong>{" "}
                    with the namespace <code>git</code> and the folder the
                    command ran in. Your device sees only a hash of the commit,
                    not its contents, and can&apos;t check which repository it
                    belongs to. Other <code>ssh-keygen -Y sign</code> requests
                    show a title such as <strong>Sign a file?</strong>.
                </p>
                <h3>Remember an approval</h3>
                <p>
                    For verified logins and git signatures, the{" "}
                    <strong>Remember</strong> section lets you skip the next
                    prompts until the vault locks:
                </p>
                <ul>
                    <li>
                        <strong>Only this request</strong>, the default.
                    </li>
                    <li>
                        This key for one program on this agent, such as{" "}
                        <code>ssh</code> on your workstation.
                    </li>
                    <li>This key for this server.</li>
                    <li>
                        For git signatures, this key for the running git
                        process, so a rebase that signs many commits asks once.
                    </li>
                </ul>
                <p>
                    Remembered approvals live only in the approving
                    device&apos;s memory. They have no time limit and end when
                    its vault locks. The history marks them{" "}
                    <strong>Approved automatically</strong>. Forwarded requests,
                    unknown destinations and signatures other than git commits
                    always ask.
                </p>
                <p>
                    Locking the vault stops signing at once, even while the
                    vault is still being saved.
                </p>
                <h3>Pause an agent</h3>
                <p>
                    If you didn&apos;t expect a request, choose{" "}
                    <strong>Pause agent</strong> at the bottom of the prompt. On
                    Android the button names the agent, such as{" "}
                    <strong>Pause work-laptop</strong>. That refuses the request
                    in front of you too. While an agent is paused, its requests
                    are refused without a prompt and its remembered approvals
                    don&apos;t apply. The pause works at once on the device you
                    used and syncs to your other devices with the vault.
                </p>
                <p>
                    You can also pause from the agent&apos;s page: with{" "}
                    <strong>Pause agent</strong> in the web app, or from the
                    menu at the top on Android. The page then shows{" "}
                    <strong>Paused</strong> with a <strong>Resume</strong>{" "}
                    button. After you resume, requests ask again.
                </p>
                <DocScreenshot
                    src="/images/docs/ssh-agent-web-agent-paused.png"
                    alt="Agent page for work-laptop with a Paused notice and a Resume button above the approver, machine, keys and recent requests"
                    caption="A paused agent. Choose Resume to get its prompts back."
                    width={2880}
                    height={2200}
                />
                <h3>On Android</h3>
                <p>
                    While your phone approves at least one agent, Android shows
                    a permanent <strong>Ready for SSH requests</strong>{" "}
                    notification. That keeps the app connected in the
                    background, also after a restart. A request shows as{" "}
                    <strong>SSH request from</strong> followed by the agent
                    name, with <strong>Review</strong> and <strong>Deny</strong>
                    . While the phone is locked or its screen is off, the
                    notification says only <strong>Approval needed</strong>,
                    also in the notification shade. The agent name comes back
                    when you unlock the phone. <strong>Deny</strong> works
                    without unlocking. <strong>Review</strong> asks you to
                    unlock the vault and then opens the request. If the app is
                    open and unlocked, the request opens straight away.
                </p>
                <p>
                    While notifications are off for Cryptex Vault, the Devices
                    tab and the agent&apos;s page show a notice with{" "}
                    <strong>Open notification settings</strong>.
                </p>
                <DocScreenshot
                    src="/images/docs/ssh-agent-android-notification.png"
                    alt="Android notification reading SSH request from work-laptop, Tap to review it, with Review and Deny buttons"
                    caption="A request while the phone is unlocked. Review opens it in the app, and Deny answers without opening the app."
                    width={720}
                    height={280}
                />
                <DocScreenshot
                    src="/images/docs/ssh-agent-android-locked.png"
                    alt="Android lock screen with a notification that reads only Approval needed"
                    caption="The same kind of request on a locked phone. The notification doesn't name the agent until you unlock."
                    width={720}
                    height={696}
                />
                <DocScreenshot
                    src="/images/docs/ssh-agent-android-request.png"
                    alt="Android SSH request screen showing 1 of 2, Sign in to git.example.com, agent work-laptop, a server name approved before, a verified host key, user git, the GitHub key and the process git push origin main, with Deny and Approve"
                    caption="The approval screen on Android. Approve works about 0.7 seconds after the screen opens."
                    width={720}
                    height={1404}
                />
                <DocScreenshot
                    src="/images/docs/ssh-agent-android-request-remember.png"
                    alt="Lower part of the Android SSH request screen with the Remember choices and a Pause work-laptop button"
                    caption="Scroll down for the Remember choices and the button that pauses this agent."
                    width={720}
                    height={1404}
                />
                <h3>In the web app</h3>
                <p>
                    The browser approves only while your vault is unlocked and a
                    vault tab is open. Requests appear as a dialog over the
                    vault. Closing the dialog denies the request. When the tab
                    is in the background, its title shows how many requests are
                    waiting, and a browser notification appears if you allowed
                    them.
                </p>
                <p>
                    Your vault can be open in only one tab at a time. Another
                    tab shows <strong>Your vault is open in another tab</strong>{" "}
                    with a <strong>Use here</strong> button. It locks the vault
                    in the first tab, which saves first, and you then unlock it
                    in the new tab. Leaving the vault for another page of the
                    site also locks it, after saving.
                </p>
                <DocScreenshot
                    src="/images/docs/ssh-agent-web-other-tab.png"
                    alt="Card reading Your vault is open in another tab, with a Use here button"
                    caption="A second tab. Use here locks the vault in the other tab, after saving, so you can unlock it here."
                    width={888}
                    height={610}
                />
                <DocCallout title="Background tabs in Chrome">
                    <p>
                        Chrome&apos;s Memory Saver can discard a tab that has
                        been hidden for a while. A discarded tab doesn&apos;t
                        answer, and requests time out until you show the tab
                        again. To keep it running, add the vault&apos;s site
                        under <strong>Always keep these sites active</strong> in
                        Chrome&apos;s Performance settings.
                    </p>
                </DocCallout>
            </DocSection>

            <DocSection id="manage" title="Manage and revoke agents">
                <p>
                    On Android, agents are listed under{" "}
                    <strong>Connected agents</strong> in the{" "}
                    <strong>List</strong> view of the Devices tab. In the web
                    app, they are under <strong>Connected Agents</strong> in the
                    sidebar. Open one to see its approver, machine, relay, keys
                    and <strong>Recent requests</strong>. The history keeps up
                    to 200 requests from the last 90 days, and it syncs to your
                    linked devices with the rest of the vault.
                </p>
                <DocScreenshot
                    src="/images/docs/ssh-agent-android-devices.png"
                    alt="Android Devices tab in the List view with a Connected agents section listing work-laptop, 2 keys, and a gear button"
                    caption="On Android, switch the Devices tab to List. Tap the agent to open it. The gear next to Connected agents opens Agent relays."
                    width={720}
                    height={1404}
                />
                <DocScreenshot
                    src="/images/docs/ssh-agent-android-agent.png"
                    alt="Android agent page for work-laptop with the pairing date under its name, the approver, the relay, a closed Keys section showing 2, and recent git signatures, one of them denied"
                    caption="The agent page on Android. Edit keys is at the top. The menu button next to it has Pause agent and Revoke agent. Tap Keys to see which keys the agent may use."
                    width={720}
                    height={1404}
                />
                <DocScreenshot
                    src="/images/docs/ssh-agent-web-agent-page.png"
                    alt="Agent page for work-laptop with approver, machine, paired date, relay, two keys, recent requests, and Pause agent and Revoke agent buttons"
                    caption="Choose the agent under Connected Agents to open its page. Edit keys is at the top, Pause agent and Revoke agent at the bottom."
                    width={2880}
                    height={2200}
                />
                <p>
                    To change which keys an agent may use, open it on the
                    approving device and choose <strong>Edit keys</strong>. The
                    agent gets the new list the next time it connects. If it
                    can&apos;t save the list to disk, it signs nothing,
                    reconnects and tries again.
                </p>
                <h3>Revoke an agent</h3>
                <p>
                    In the web app, open the agent and choose{" "}
                    <strong>Revoke agent</strong>. On Android, open the agent,
                    tap the menu button at the top and choose{" "}
                    <strong>Revoke agent</strong>. Any of your linked devices
                    can do this. On the machine itself, run:
                </p>
                <DocScreenshot
                    src="/images/docs/ssh-agent-android-agent-menu.png"
                    alt="Android agent page with a sheet for work-laptop offering Pause agent and Revoke agent"
                    caption="The menu on the agent page on Android, with Pause agent and Revoke agent."
                    width={720}
                    height={1404}
                />
                <DocCode>{`cryptex-agent unpair`}</DocCode>
                <p>
                    A revoked agent lists no keys and signs nothing until you
                    pair it again. If the agent uses a relay you run yourself,
                    revoke it from the approving device or with{" "}
                    <code>cryptex-agent unpair</code>.
                </p>
                <p>
                    To pair a machine with a different device, run{" "}
                    <code>cryptex-agent pair --force</code>. It replaces the
                    existing pairing.
                </p>
            </DocSection>

            <DocSection id="relay" title="The relay">
                <p>
                    The agent and your device never connect directly. Both keep
                    a connection open to a relay, which passes the encrypted
                    requests and answers between them. The relay can&apos;t read
                    them or sign anything. It sees which agent talks to which
                    device, when, and how much.
                </p>
                <ul>
                    <li>
                        <strong>Hosted relay.</strong>{" "}
                        <code>relay.cryptex-vault.com</code> comes with{" "}
                        <Link href="/docs/online-services">
                            Online Services
                        </Link>
                        . The approving device must be signed in to Online
                        Services. <code>cryptex-agent pair</code> uses it by
                        default.
                    </li>
                    <li>
                        <strong>Your own relay.</strong> The relay is open
                        source. Run it with an access token and pair with{" "}
                        <code>--relay</code>. The{" "}
                        <Link href="/docs/self-hosting#agent-relay">
                            self-hosting guide
                        </Link>{" "}
                        adds it to the self-hosted stack.
                    </li>
                </ul>
                <p>
                    Each agent keeps the relay it was paired on. To see or
                    change the access tokens a device has saved, open{" "}
                    <strong>Agent relays</strong>. In the web app, that is the
                    gear next to <strong>Connected Agents</strong>. On Android,
                    it is the gear next to <strong>Connected agents</strong> in
                    the <strong>List</strong> view of the Devices tab. Before
                    you connect an agent, tap <strong>+</strong> on the Devices
                    tab, choose <strong>Create invitation</strong>, then{" "}
                    <strong>Advanced connection</strong> and{" "}
                    <strong>Manage custom servers</strong>. The SSH agents
                    section of that screen has <strong>Agent relays</strong>.
                </p>
                <DocScreenshot
                    src="/images/docs/ssh-agent-android-relays.png"
                    alt="Android Agent relays screen with the hosted relay from Online Services, one own relay with its access token saved, an Add relay button and Battery settings"
                    caption="Agent relays on Android. Tap a relay of your own to change its access token. Battery settings lets the app keep running in the background."
                    width={720}
                    height={1143}
                />
                <p>
                    A relay address must start with <code>https://</code>. Plain{" "}
                    <code>http://</code> works only for a relay on the same
                    machine (<code>localhost</code>, <code>127.0.0.1</code> or{" "}
                    <code>[::1]</code>), for testing. The agent, the Android app
                    and the web app all refuse other <code>http://</code>{" "}
                    addresses. The agent also doesn&apos;t follow redirects, so
                    a relay can&apos;t send it to another server.
                </p>
                <p>
                    Pass the relay&apos;s address exactly as the relay knows it
                    (its <code>RELAY_PUBLIC_URL</code>). Sign-ins are checked
                    against that address, so <code>localhost</code> fails on a
                    relay set up as <code>127.0.0.1</code>, even on the same
                    machine. The app then reports the pairing code as expired.
                </p>
                <p>
                    To use a relay other than the hosted one by default, set{" "}
                    <code>relay = https://relay.example.com</code> in{" "}
                    <code>~/.config/cryptex-agent/config</code>.
                </p>
            </DocSection>

            <DocSection id="troubleshooting" title="Troubleshooting">
                <h3>No request arrives</h3>
                <ul>
                    <li>
                        Run <code>cryptex-agent status</code>. It shows the
                        pairing, the granted keys and whether the service is
                        running. <code>journalctl --user -u cryptex-agent</code>{" "}
                        shows relay connection errors.
                    </li>
                    <li>
                        On Android, check that notifications are allowed for
                        Cryptex Vault in the system settings, and that the{" "}
                        <strong>Ready for SSH requests</strong> notification is
                        there. If requests arrive late or not at all while the
                        phone is idle, open <strong>Battery settings</strong> on
                        the <strong>Agent relays</strong> screen and let Cryptex
                        Vault run in the background.
                    </li>
                    <li>
                        In the web app, unlock the vault and keep a vault tab
                        open. If Chrome discarded the tab, switch to it once.
                    </li>
                    <li>
                        Requests go to the device that approves the agent. The
                        agent&apos;s page shows which one under{" "}
                        <strong>Approver</strong>.
                    </li>
                </ul>
                <h3>The pairing code doesn&apos;t work</h3>
                <p>
                    Codes expire after three minutes and work once. Press Enter
                    in the terminal for a new code, or run{" "}
                    <code>cryptex-agent pair</code> again. If the device says
                    the code is for your own relay, enter that relay&apos;s
                    access token.
                </p>
                <h3>ssh-add -L lists nothing</h3>
                <ul>
                    <li>
                        <strong>The agent has no identities</strong> means the
                        agent isn&apos;t paired, was revoked, or has no keys
                        granted. <code>cryptex-agent status</code> says which.
                        Pair again, or use <strong>Edit keys</strong> on the
                        approving device.
                    </li>
                    <li>
                        <strong>Could not open a connection</strong> or{" "}
                        <strong>Error connecting to agent</strong> means{" "}
                        <code>SSH_AUTH_SOCK</code> isn&apos;t set in this shell,
                        or the service isn&apos;t running. Run{" "}
                        <code>systemctl --user enable --now cryptex-agent</code>{" "}
                        and export the variable again.
                    </li>
                    <li>
                        If it lists other keys, <code>SSH_AUTH_SOCK</code>{" "}
                        points at another agent.
                    </li>
                </ul>
                <h3>agent refused operation</h3>
                <p>
                    <code>ssh</code> prints this when the agent didn&apos;t get
                    a signature. Usually the request was denied, or nobody
                    answered within 90 seconds. It also happens when the key
                    isn&apos;t granted to this agent anymore, the agent was
                    revoked, or the device can&apos;t sign with that key type.
                    The agent logs the reason:{" "}
                    <code>journalctl --user -u cryptex-agent</code> shows a{" "}
                    <strong>Signature not given</strong> line with it.
                </p>
            </DocSection>
        </DocArticle>
    );
}
