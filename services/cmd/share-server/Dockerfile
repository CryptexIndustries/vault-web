# Build from the services/ directory:
#   docker build -f cmd/share-server/Dockerfile services
# CI passes VERSION (1.2.3) from the share-server-v1.2.3 tag.
FROM golang:1.26-alpine@sha256:9ce231b28998b32e116927c61aa5c406183061d4f3f2d61b292c88e7f6bdf7ca AS build
ARG VERSION=dev
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w -X main.version=${VERSION}" -o /out/share-server ./cmd/share-server \
    && mkdir -p /out/data

FROM gcr.io/distroless/static-debian12:nonroot@sha256:afa5c872c891853ca7fcf1f12c3edb23f7eeef36189728842dd51042ff57f7ab
COPY --from=build /out/share-server /usr/local/bin/share-server
COPY --from=build --chown=nonroot:nonroot /out/data /data
ENV SHARE_DB_PATH=/data/share.db \
    SHARE_LISTEN_ADDR=:8080
VOLUME /data
# 8080 is the share API. 9090 serves /metrics for an internal network only;
# never publish it. SHARE_METRICS_ADDR=off turns it off.
EXPOSE 8080 9090
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD ["/usr/local/bin/share-server", "healthcheck"]
ENTRYPOINT ["/usr/local/bin/share-server"]
