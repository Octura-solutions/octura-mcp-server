# The bridge has no dependencies, so there is no install step and nothing in
# the image but Node and one file. That is deliberate: a build that never runs
# `npm install` cannot fail on a registry blip or a transitive package.
FROM node:22-alpine

WORKDIR /app

COPY package.json ./
COPY src ./src

# Run unprivileged. The node image already ships a `node` user.
USER node

# Overridable so the image can be pointed at a staging endpoint.
ENV OCTURA_MCP_URL=https://octurasolutions.com/mcp

# stdio transport: the client talks to this process over stdin/stdout, so
# there is no port to expose and no healthcheck to define.
ENTRYPOINT ["node", "src/bridge.mjs"]
