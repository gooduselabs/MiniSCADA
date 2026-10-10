FROM ubuntu:20.04
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
      g++ gcc g++-arm-linux-gnueabihf gcc-arm-linux-gnueabihf cmake ninja-build make file ca-certificates clang-format \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /src
