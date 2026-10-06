# Contributing to Cryptex Vault

You can help by reporting a problem, improving the docs, or changing the code.

## Choose where to post

- [Open an issue](https://github.com/CryptexIndustries/vault-web/issues/new/choose) for a problem with the web app, website, Chromium Extension, documentation, or self-hosted deployment. Search [existing issues](https://github.com/CryptexIndustries/vault-web/issues) first.
- Use [GitHub Discussions](https://github.com/CryptexIndustries/vault-web/discussions) for questions, setup help, and ideas that still need discussion.
- Follow the [security policy](SECURITY.md) for vulnerabilities. Please do not post security details in a public issue or Discussion.

## Reporting a problem

Give the issue a title that names the failing action and result. The issue form asks for the affected area, what happened, steps to reproduce it, what you expected, and your environment. Use sample data where possible. If you cannot reproduce the problem every time, say how often it happens and what you were doing when it last occurred.

Include the app version or commit, browser and operating system, and relevant deployment details when you know them. Logs and screenshots can help, but remove passwords, recovery codes, vault data, tokens, private URLs, and personal information before posting. Never upload a real vault or `.env` file.

## Sending a pull request

For a larger change, start a Discussion so the behavior and scope are clear before you build it. For a bug or documentation fix, a focused pull request is fine.

Set up the project using the [README's local development steps](README.md#develop-locally). In the pull request, explain what changed and why, link the related issue if there is one, and say how you checked the result. Screenshots are useful for visible interface changes. Add or update tests when a behavior change needs them.

Run `pnpm lint` and `pnpm test` before submitting. For changes to the web app or extension, also run the relevant type check: `pnpm lint-tsc:web` or `pnpm --filter extension lint-tsc`. Lefthook formats supported staged files before commits, but it does not run these checks for you.
