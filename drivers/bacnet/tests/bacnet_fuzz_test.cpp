// Timed fuzz of the BACnet/IP decoders (feature 020, SC-001; core/common/tests/fuzz_util.hpp):
// mutated datagrams and service data never crash a decoder nor read past their buffer (the ASan
// run catches that), and mutated addresses never crash the parser. MAT_FUZZ_SECONDS (3 s by
// default, 20 s under the sanitizer run of ctest); tools/fuzz/cpp/run.sh runs it longer.
#include <gtest/gtest.h>

#include <cstdio>
#include <fstream>

#include "core/common/tests/fuzz_util.hpp"
#include "drivers/bacnet/address.hpp"
#include "drivers/bacnet/codec.hpp"
#include "nlohmann/json.hpp"

namespace {

using mat::bacnet::Bytes;
using mat::fuzz::Rng;

Bytes mutate(Bytes b, Rng& r) {
    const int ops = 1 + static_cast<int>(r.below(4));
    for (int k = 0; k < ops; ++k) {
        const size_t at = r.below(b.size() + 1);
        switch (r.below(6)) {
            case 0:
                if (!b.empty()) b[r.below(b.size())] ^= static_cast<uint8_t>(1u << r.below(8));
                break;
            case 1:
                if (!b.empty()) b[r.below(b.size())] = static_cast<uint8_t>(r.next());
                break;
            case 2:
                b.resize(r.below(b.size() + 1));
                break;
            case 3:
                b.insert(b.begin() + static_cast<long>(at), static_cast<uint8_t>(r.next()));
                break;
            case 4: {  // interesting tag bytes: extended lengths, opening / closing tags
                static const uint8_t kBytes[] = {0x05, 0xfe, 0xff, 0x3e, 0x3f,
                                                 0x75, 0xf5, 0x1e, 0x1f};
                b.insert(b.begin() + static_cast<long>(at), kBytes[r.below(sizeof kBytes)]);
                break;
            }
            default:  // keep the BVLC length right so that the NPDU / APDU are reached
                if (b.size() >= 4 && b.size() < 65536) {
                    b[2] = static_cast<uint8_t>(b.size() >> 8);
                    b[3] = static_cast<uint8_t>(b.size());
                }
                break;
        }
    }
    return b;
}

std::vector<Bytes> seeds() {
    std::ifstream f(std::string(MAT_SOURCE_DIR) + "/tests/bacnet-vectors/frames.json",
                    std::ios::binary);
    const nlohmann::json v = nlohmann::json::parse(f);
    std::vector<Bytes> out;
    for (const auto& c : v["decode"]) out.push_back(mat::bacnet::fromHex(c["hex"]));
    for (const auto& c : v["encode"]) out.push_back(mat::bacnet::fromHex(c["hex"]));
    return out;
}

}  // namespace

TEST(BacnetFuzz, DecodersSurviveMutatedDatagrams) {
    using namespace mat::bacnet;
    const std::vector<Bytes> seed = seeds();
    Rng rng{mat::fuzz::baseSeed()};
    mat::fuzz::Deadline deadline(mat::fuzz::budgetSeconds(3));
    uint64_t inputs = 0, parsed = 0;
    while (!deadline.passed()) {
        const Bytes b = mutate(seed[rng.below(seed.size())], rng);
        ++inputs;
        Frame f;
        if (!parseFrame(b, f)) continue;
        ++parsed;
        if (f.hasApdu) {
            ASSERT_LE(f.dataLen, b.size());
            IAm i;
            decodeIAm(f.data, f.dataLen, i);
            PropertyResult p;
            decodeReadPropertyAck(f.data, f.dataLen, p);
            std::vector<PropertyResult> rs;
            decodeReadPropertyMultipleAck(f.data, f.dataLen, rs);
            Reader r(f.data, f.dataLen);
            while (!r.atEnd() && r.skip()) {
            }
        }
    }
    std::printf("fuzz bacnet: %llu inputs, %llu frames parsed\n",
                static_cast<unsigned long long>(inputs), static_cast<unsigned long long>(parsed));
    EXPECT_GT(inputs, 100u);
}

TEST(BacnetFuzz, AddressParserSurvivesMutatedText) {
    Rng rng{mat::fuzz::baseSeed() + 1};
    const std::vector<std::string> dict = {
        "AI", "MSV", "DEV", ":", "@", "present-value", "16", "6", "relinquish", "4194303", "units"};
    mat::fuzz::Deadline deadline(mat::fuzz::budgetSeconds(1));
    const mat::TagType types[] = {mat::TagType::BOOL, mat::TagType::FLOAT32, mat::TagType::UINT16,
                                  mat::TagType::STRING};
    uint64_t n = 0;
    while (!deadline.passed()) {
        const std::string t = mat::fuzz::mutateText("AO:1:relinquish@8", rng, dict);
        mat::bacnet::AddressOptions o;
        o.rawType = types[rng.below(4)];
        o.rw = rng.chance(50);
        const mat::bacnet::Address a = mat::bacnet::parseAddress(t, o);
        if (a.ok) {  // a valid address round trips through its normal form
            const mat::bacnet::Address b = mat::bacnet::parseAddress(a.normalized, o);
            ASSERT_TRUE(b.ok) << t;
            EXPECT_EQ(b.normalized, a.normalized);
        }
        ++n;
    }
    EXPECT_GT(n, 100u);
}
