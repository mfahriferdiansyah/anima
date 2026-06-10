# Build
FROM golang:1.25-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -ldflags="-s -w" -o /bin/api ./cmd/api

# Run — distroless static: no shell, no package manager, CA certs included
# (needed for TLS to OpenRouter). The container holds no state by design.
FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /bin/api /api
EXPOSE 8080
ENTRYPOINT ["/api"]
