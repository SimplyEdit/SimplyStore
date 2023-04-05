# ==============================================================================
# Dependencies
# ------------------------------------------------------------------------------
FROM node:18-alpine3.17 as builder

WORKDIR /usr/src/app
COPY package.json ./

# @TODO: Once development is stable, `npm ci --only=production` should be used instead of `npm install`
RUN npm install --omit=dev
# ==============================================================================


# ==============================================================================
# Application
# ------------------------------------------------------------------------------
FROM alpine:3.17

ENV NODE_ENV=production

RUN addgroup -g 1000 node \
    && adduser -u 1000 -G node -s /bin/sh -D node \
    && apk add --no-cache nodejs=~18.14

COPY --chown=node:node . /app
COPY --chown=node:node --from=builder /usr/src/app/node_modules /app/node_modules

WORKDIR /app

CMD [ "node", "/app/src/main.mjs" ]
# ==============================================================================


# ==============================================================================
# Metadata
# ------------------------------------------------------------------------------
# @TODO: Once development is stable, the following should also be added
#    org.label-schema.build-date=${BUILD_DATE} \ # Usually $(date --iso-8601=seconds)
#    org.label-schema.vcs-ref=${BUILD_REF} \ # Usually $(git describe --tags --always)
#    org.label-schema.version=${VERSION} \ # Usually $(git describe --tags --abbrev=0)
#    org.opencontainers.image.created="${BUILD_DATE}" \
#    org.opencontainers.image.version="${VERSION}"
LABEL maintainer="Auke van Slooten <auke@muze.nl>" \
    org.label-schema.description="JSONTag REST Server" \
    org.label-schema.docker.cmd='docker run --expose 3000 --interactive --name=jsontag-rest-server --rm --tty --volume "\$PWD/my-data.json:/app/data.jsontag" jsontag-rest-server' \
    org.label-schema.schema-version="1.0" \
    org.label-schema.name="jsontag-rest-server" \
    org.label-schema.url="https://github.com/poef/jsontag-rest-server" \
    org.label-schema.usage="https://github.com/poef/jsontag-rest-server" \
    org.label-schema.vcs-url="https://github.com/poef/jsontag-rest-server" \
    org.label-schema.vendor="Auke van Slooten" \
    org.opencontainers.image.authors="Auke van Slooten <auke@muze.nl>" \
    org.opencontainers.image.description="JSONTag REST Server" \
    org.opencontainers.image.documentation="https://github.com/poef/jsontag-rest-server" \
    org.opencontainers.image.licenses="MIT" \
    org.opencontainers.image.source="https://github.com/poef/jsontag-rest-server" \
    org.opencontainers.image.title="jsontag-rest-server" \
    org.opencontainers.image.url="https://github.com/poef/jsontag-rest-server" \
    org.opencontainers.image.vendor="Auke van Slooten"
# ==============================================================================
