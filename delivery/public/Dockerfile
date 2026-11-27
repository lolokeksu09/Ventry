FROM golang:1.27.4-bookworm AS build
WORKDIR /src
COPY delivery/public/go.mod delivery/public/*.go ./
RUN CGO_ENABLED=0 go test ./... && CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /gateway .
FROM scratch
COPY --from=build /gateway /gateway
USER 10003:10003
ENTRYPOINT ["/gateway"]
