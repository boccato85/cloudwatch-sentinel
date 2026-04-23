# Build stage - pinned to match go.mod (go 1.25.0)
FROM golang:1.25-alpine AS builder

WORKDIR /app

# Install build dependencies
RUN apk add --no-cache git

# Copy go mod files and adjust version for container build
COPY go.mod go.sum ./
RUN go mod download

# Copy source code
COPY . .

# Build binary
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-w -s" -o sentinel-agent .

# Runtime stage
FROM alpine:3.21

WORKDIR /app

# Install CA certificates and timezone data
RUN apk add --no-cache ca-certificates tzdata

# Copy binary from builder
COPY --from=builder /app/sentinel-agent .

# Create non-root user
RUN adduser -D -u 1000 sentinel
USER sentinel

# Expose port
EXPOSE 8080

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:8080/api/summary || exit 1

ENTRYPOINT ["./sentinel-agent"]
