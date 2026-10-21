# Build from the services/ directory:
#   docker build -f cmd/relay-server/Dockerfile services
FROM golang:1.26-alpine@sha256:3082400e369fa24d5fc60bca20edab3f6d604e0c5a690ec66b295eff4dd87ade AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/relay-server ./cmd/relay-server \
    && mkdir -p /out/data

FROM gcr.io/distroless/static-debian12:nonroot@sha256:afa5c872c891853ca7fcf1f12c3edb23f7eeef36189728842dd51042ff57f7ab
COPY --from=build /out/relay-server /usr/local/bin/relay-server
COPY --from=build --chown=nonroot:nonroot /out/data /data
ENV RELAY_DB_PATH=/data/relay.db \
    RELAY_LISTEN_ADDR=:8080
VOLUME /data
# 8080 serves /v1/connect, /v1/pair and /v1/revoke behind an HTTPS proxy.
# 9090 serves /metrics for an internal network only; never publish it.
# RELAY_METRICS_ADDR=off turns it off.
EXPOSE 8080 9090
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD ["/usr/local/bin/relay-server", "healthcheck"]
ENTRYPOINT ["/usr/local/bin/relay-server"]
