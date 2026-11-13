# The one place the project's unit and web tests run when an agent starts them.
# Each base image is pinned; raise a pin on purpose, in a change of its own.
FROM node:22-slim AS node
# The .NET 10 SDK, the major CI installs (.github/workflows/ci.yml).
FROM mcr.microsoft.com/dotnet/sdk@sha256:548d93f8a18a1acbe6cc127bc4f47281430d34a9e35c18afa80a8d6741c2adc3
RUN apt-get update \
 && apt-get install -y --no-install-recommends git jq perl \
 && rm -rf /var/lib/apt/lists/*
COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=node /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -s ../lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
 && ln -s ../lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx
ENV DOTNET_CLI_TELEMETRY_OPTOUT=1 DOTNET_NOLOGO=1 MSBUILDDISABLENODEREUSE=1 CI=1
