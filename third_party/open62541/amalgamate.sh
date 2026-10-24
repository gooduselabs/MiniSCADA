#!/bin/sh
# Generates the open62541 amalgamation (open62541.c, open62541.h) of third_party/open62541 with the
# mAT options (feature 019, VERSION.txt). Runs in a throwaway container of the toolchain image:
#   docker run --rm -v <open62541-1.4.21>:/in:ro -v <out>:/out -v <this file>:/gen.sh:ro \
#     mat-armhf sh /gen.sh
# /in = the release source tarball unpacked (read only), /out = where the two files go. python3 and
# the Mbed TLS headers of Ubuntu are only needed by the generator; the build uses third_party/mbedtls.
set -e
apt-get update >/dev/null && apt-get install -y --no-install-recommends python3 libmbedtls-dev >/dev/null
rm -rf /tmp/b && mkdir /tmp/b && cd /tmp/b
cmake /in -G Ninja \
  -DCMAKE_BUILD_TYPE=Release \
  -DUA_ENABLE_AMALGAMATION=ON \
  -DUA_ENABLE_ENCRYPTION=MBEDTLS \
  -DUA_NAMESPACE_ZERO=MINIMAL \
  -DUA_ENABLE_SUBSCRIPTIONS=ON \
  -DUA_ENABLE_SUBSCRIPTIONS_EVENTS=OFF \
  -DUA_ENABLE_METHODCALLS=OFF \
  -DUA_ENABLE_NODEMANAGEMENT=OFF \
  -DUA_ENABLE_HISTORIZING=OFF \
  -DUA_ENABLE_DISCOVERY=OFF \
  -DUA_ENABLE_DISCOVERY_MULTICAST=OFF \
  -DUA_ENABLE_PUBSUB=OFF -DUA_ENABLE_PUBSUB_INFORMATIONMODEL=OFF -DOPEN62541_VERSION=v1.4.21 \
  -DUA_ENABLE_JSON_ENCODING=OFF \
  -DUA_ENABLE_XML_ENCODING=OFF \
  -DUA_ENABLE_NODESETLOADER=OFF \
  -DUA_ENABLE_DIAGNOSTICS=OFF \
  -DUA_ENABLE_TYPEDESCRIPTION=ON \
  -DUA_ENABLE_PARSING=ON \
  -DUA_ENABLE_STATUSCODE_DESCRIPTIONS=ON \
  -DUA_ENABLE_DA=OFF \
  -DUA_ENABLE_QUERY=OFF \
  -DUA_MULTITHREADING=0 \
  -DUA_LOGLEVEL=300 \
  -DUA_BUILD_EXAMPLES=OFF -DUA_BUILD_UNIT_TESTS=OFF
ninja open62541-amalgamation-source open62541-amalgamation-header
cp open62541.c open62541.h /out/
