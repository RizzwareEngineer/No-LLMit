# Base images come from Amazon's public mirror of the official Docker images, which is
# not subject to Docker Hub's pull rate limits.
FROM public.ecr.aws/docker/library/golang:1.22-alpine AS builder

WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -o server .

FROM public.ecr.aws/docker/library/alpine:latest
RUN apk --no-cache add ca-certificates
WORKDIR /root/
COPY --from=builder /app/server .
EXPOSE 8080
CMD ["./server"]

