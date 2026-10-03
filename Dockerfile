FROM golang:1.27 AS build
WORKDIR /src
COPY go.mod ./
COPY cmd ./cmd
COPY internal ./internal
RUN go build -o /out/server ./cmd/server

FROM eclipse-temurin:21-jre
WORKDIR /app
COPY --from=build /out/server ./server
COPY bin/sign-oracle.jar bin/libheyteago.so ./bin/
EXPOSE 8790
CMD ["./server"]
