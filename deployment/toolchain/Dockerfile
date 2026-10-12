FROM ubuntu:20.04
ENV DEBIAN_FRONTEND=noninteractive
# libmariadb-dev, freetds-dev, libpq-dev, libcurl4-openssl-dev (amd64): only for client_api_check_test
# and the historian integration tests (feature 003). The armhf runtime loads these client libraries
# with dlopen at run time and never links them.
# qemu-user: armhf smoke test (smoke-armhf.sh) — a fault of the 32-bit build only shows there.
# curl, openssl (amd64): only for tests (feature 005) — a TLS client for the HTTPS tests, the armhf
# smoke test and device-it, and `openssl x509 -fingerprint -sha256`. The device binary links neither:
# mat-runtime carries its own TLS (third_party/mbedtls).
RUN apt-get update && apt-get install -y --no-install-recommends \
      g++ gcc g++-arm-linux-gnueabihf gcc-arm-linux-gnueabihf cmake ninja-build make file ca-certificates clang-format \
      libmariadb-dev freetds-dev libpq-dev libcurl4-openssl-dev qemu-user curl openssl \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /src
