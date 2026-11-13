# Base images come from Amazon's public mirror of the official Docker images, which is
# not subject to Docker Hub's pull rate limits.
FROM public.ecr.aws/docker/library/golang:1.25-alpine AS builder

WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -o server .

FROM public.ecr.aws/docker/library/alpine:latest
RUN apk --no-cache add ca-certificates
WORKDIR /app
COPY --from=builder /app/server .
# Not root. Without Supabase hands go to HAND_LOG_DIR (default data/), so that folder is the user's.
RUN mkdir data && chown nobody data
USER nobody
EXPOSE 8080
CMD ["./server"]

