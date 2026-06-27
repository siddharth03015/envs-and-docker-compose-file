FROM golang:1.23-alpine AS builder

WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download

COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -o exchange-engine ./cmd/server

# --- Final image ---
FROM alpine:3.20
RUN apk add --no-cache ca-certificates tzdata

WORKDIR /app
COPY --from=builder /app/exchange-engine .

# Data directory for SQLite
RUN mkdir -p /data

EXPOSE 8080

ENV PORT=8080
ENV DB_PATH=/data/exchange.db
ENV JWT_SECRET=change-me-in-production

CMD ["./exchange-engine"]
