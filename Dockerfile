FROM golang:1.27 AS build
WORKDIR /src
COPY go.mod ./
COPY cmd ./cmd
COPY internal ./internal
RUN go build -o /out/server ./cmd/server

FROM python:3.13-slim AS pydeps
RUN pip install --no-cache-dir unicorn pyelftools requests cryptography

FROM eclipse-temurin:21-jre
WORKDIR /app
COPY --from=build /out/server ./server
COPY --from=pydeps /usr/local /usr/local
COPY bin/sign-oracle.jar bin/libheyteago.so bin/libsdk_core.so ./bin/
COPY tools/secure-ticket ./tools/secure-ticket
EXPOSE 8790
CMD ["./server"]
