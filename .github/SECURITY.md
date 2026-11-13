# Security Policy

## Supported versions

Security fixes are applied to `main` and ship in the next release. The release
workflow (`.github/workflows/release.yml`) builds the desktop packages when a
`v<version>` tag is pushed and publishes them on the [releases page][releases].
No support policy for older releases is written: to get a fix, update to the
latest release.

[releases]: https://github.com/vitorafgomes/messaging-explorer/releases

## Reporting a vulnerability

**Do not open a public issue for security vulnerabilities.**

Report them privately through GitHub's ["Report a vulnerability"][ghsa]
feature on this repository, which opens a private security advisory.

[ghsa]: https://github.com/vitorafgomes/messaging-explorer/security/advisories/new

Please include:

- A description of the vulnerability
- Steps to reproduce
- Potential impact
- Any suggested fix, if you have one

## Scope

messaging-explorer reads and changes real messages on the brokers it is
pointed at. Its security model: the local API listens on `127.0.0.1` only and
accepts a request only with the key generated at each start; a secret leaves
the API only masked unless the user asks for it; nothing is sent anywhere
except the calls to the broker and the update check against GitHub. In scope:

- A request that reaches the API without the key, or from another host
- A secret (connection string, password, token) in a log line, an error
  message, an API response or an export where it should be masked
- A message lost, or sent again without the user asking, by a delete, purge,
  move or resubmit
- Any call to a host other than the configured broker and GitHub's update check
- Injection through a connection value or a message reaching the broker or the shell
- Supply-chain issues in dependencies

Out of scope:

- Saved connections being readable on the user's own disk: they are stored in
  plain text by design, as the README states
- Issues that need physical access to the machine
