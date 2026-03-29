FROM golang:1.24-alpine AS builder

ARG MEM9_REF=main

RUN apk add --no-cache git ca-certificates
WORKDIR /src
RUN git clone --depth 1 --branch "${MEM9_REF}" https://github.com/mem9-ai/mem9.git .
WORKDIR /src/server
RUN go build -o /out/mnemo-server ./cmd/mnemo-server

FROM alpine:3.19
RUN apk add --no-cache ca-certificates wget
COPY --from=builder /out/mnemo-server /mnemo-server
EXPOSE 8080
ENTRYPOINT ["/mnemo-server"]
