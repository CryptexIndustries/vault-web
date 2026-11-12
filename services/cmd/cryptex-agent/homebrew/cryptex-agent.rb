# Published to CryptexIndustries/homebrew-tap by the Homebrew jobs in
# .github/workflows/cryptex-agent.yml. They fill in tag and revision with sed,
# so keep each of those on its own single line.
class CryptexAgent < Formula
  desc "SSH agent that holds no keys and asks Cryptex Vault on your phone to sign"
  homepage "https://www.cryptex-vault.com/docs/ssh-agent"
  url "https://github.com/CryptexIndustries/vault-web.git",
      tag:      "cryptex-agent-v0.2.0",
      revision: "0000000000000000000000000000000000000000"
  license "AGPL-3.0-only"

  # The monorepo also tags its web, extension and Android releases.
  livecheck do
    url :stable
    regex(/^cryptex-agent-v(\d+(?:\.\d+)+)$/i)
  end

  depends_on "go" => :build
  depends_on :macos

  def install
    cd "services" do
      system "go", "build", *std_go_args(ldflags: "-X main.version=#{version}"), "./cmd/cryptex-agent"
    end
  end

  def caveats
    <<~EOS
      Pair this machine with Cryptex Vault:
        cryptex-agent pair

      Then point SSH at the agent, for example in your shell profile:
        export SSH_AUTH_SOCK=$HOME/.local/share/cryptex-agent/cryptex-agent.sock
    EOS
  end

  service do
    run [opt_bin/"cryptex-agent", "run"]
    keep_alive successful_exit: false
    log_path var/"log/cryptex-agent.log"
    error_log_path var/"log/cryptex-agent.log"
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/cryptex-agent version")
    assert_match "Not paired", shell_output("#{bin}/cryptex-agent status")
  end
end
