// live_bench (feature 011, docs/reports/011-load.md, L1): what LiveHub::tick costs the CPU on the
// machine it runs on (x64, or the BL335 with the armhf build). Built only on request
// (`cmake --build <dir> --target live_bench`), never deployed.
//
//   live_bench [--tags 500] [--sessions 10] [--seconds 30] [--hz 4] [--change 100] [--subs all]
//
// A TagStore of `tags` Tags (FLOAT64 mostly, some BOOL, INT32, INT64 and STRING, a few BAD with a
// reason), `sessions` live sessions that each subscribe `subs` of them ("all", or a number: that
// many Tags from a different offset per session), and `hz` x `seconds` ticks. Before each tick
// `change` % of the Tags get a new value (the simulation provider of L1 moves all of them); the
// time of LiveHub::tick alone is measured (delta building + enqueue into a transport that only
// counts the bytes and frees the text, as the writer thread does after the frame went out).
// Prints the mean / p50 / p99 / max in us per tick, and the share of one core at `hz` ticks/s.
#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include <vector>

#include "server/websocket/live_hub.hpp"

using namespace mat;

namespace {

struct CountingTransport : LiveTransport {
    uint64_t messages = 0;
    uint64_t bytes = 0;
    SendQueue::PushResult push(uint64_t, std::string text) override {
        ++messages;
        bytes += text.size();
        return SendQueue::PushResult::Ok;  // `text` is freed here, as after the frame went out
    }
    void close(uint64_t, int, const std::string&) override {}
};

double nowUs() {
    return std::chrono::duration<double, std::micro>(
               std::chrono::steady_clock::now().time_since_epoch())
        .count();
}

}  // namespace

int main(int argc, char** argv) {
    size_t tags = 500, sessions = 10, subs = 0;  // subs 0: all
    double seconds = 30, hz = 4, changePct = 100;
    for (int a = 1; a + 1 < argc; a += 2) {
        const std::string k = argv[a];
        const char* v = argv[a + 1];
        if (k == "--tags")
            tags = std::strtoul(v, nullptr, 10);
        else if (k == "--sessions")
            sessions = std::strtoul(v, nullptr, 10);
        else if (k == "--seconds")
            seconds = std::strtod(v, nullptr);
        else if (k == "--hz")
            hz = std::strtod(v, nullptr);
        else if (k == "--change")
            changePct = std::strtod(v, nullptr);
        else if (k == "--subs")
            subs = std::strcmp(v, "all") == 0 ? 0 : std::strtoul(v, nullptr, 10);
        else {
            std::fprintf(stderr, "unknown option %s\n", k.c_str());
            return 2;
        }
    }
    if (tags == 0 || sessions == 0 || hz <= 0) return 2;
    if (subs == 0 || subs > tags) subs = tags;

    TagStore store;
    for (size_t i = 0; i < tags; ++i) {
        TagType t = TagType::FLOAT64;
        if (i % 10 == 1) t = TagType::BOOL;
        if (i % 10 == 2) t = TagType::INT32;
        if (i % 50 == 3) t = TagType::INT64;
        if (i % 50 == 4) t = TagType::STRING;
        store.add({"Area" + std::to_string(i / 50) + ".Line.Tag_" + std::to_string(i), t, ""});
    }
    int64_t epoch = 1760000000000;
    int64_t round = 0;
    auto update = [&](bool all) {
        ++round;
        const size_t step = changePct >= 100 ? 1 : std::max<size_t>(1, size_t(100 / changePct));
        for (size_t i = (all ? 0 : size_t(round) % step); i < tags; i += (all ? 1 : step)) {
            const TagType t = store.def(i).type;
            const double x = 20.0 + 5.0 * std::sin(0.01 * double(round) + double(i)) +
                             double(round % 1000) * 1e-3;
            const Quality q = (i % 97 == 5) ? Quality::BAD : Quality::GOOD;
            const std::string reason = q == Quality::BAD ? "COMM_TIMEOUT" : "";
            TagScalar v;
            switch (t) {
                case TagType::BOOL:
                    v = ((round + int64_t(i)) % 2) == 0;
                    break;
                case TagType::INT32:
                    v = int64_t(round * 3 + int64_t(i));
                    break;
                case TagType::INT64:
                    v = int64_t(round * 1000003 + int64_t(i));
                    break;
                case TagType::STRING:
                    v = "state " + std::to_string(round % 7);
                    break;
                default:
                    v = x;
            }
            store.set(i, std::move(v), q, reason, epoch, epoch);
        }
    };
    update(true);

    CountingTransport tx;
    HubOptions o;
    o.serverVersion = "bench";
    o.maxClients = sessions;
    o.heartbeatMs = 5000;
    o.maxSubscribeTags = std::max<size_t>(tags, 1000);
    o.maxMessageBytes = 1 << 22;
    LiveHub hub(store, tx, o, [&] { return epoch; });
    for (size_t s = 1; s <= sessions; ++s) {
        hub.onOpen(s);
        std::string m = "{\"type\":\"subscribe\",\"requestId\":\"bench-" + std::to_string(s) +
                        "\",\"mode\":\"delta\",\"tags\":[";
        for (size_t k = 0; k < subs; ++k) {
            if (k) m += ',';
            m += "\"" + store.def((k + (s - 1) * 37) % tags).id + "\"";
        }
        m += "]}";
        hub.onMessage(s, m.data(), m.size());
    }
    hub.tick();  // the dirty set of the setup
    tx.messages = tx.bytes = 0;

    const size_t ticks = std::max<size_t>(1, size_t(seconds * hz));
    const int64_t periodMs = int64_t(1000 / hz);
    std::vector<double> us;
    us.reserve(ticks);
    double updateUs = 0;
    for (size_t k = 0; k < ticks; ++k) {
        epoch += periodMs;
        const double u0 = nowUs();
        update(false);
        const double t0 = nowUs();
        hub.tick();
        const double t1 = nowUs();
        updateUs += t0 - u0;
        us.push_back(t1 - t0);
    }
    std::vector<double> sorted = us;
    std::sort(sorted.begin(), sorted.end());
    double sum = 0;
    for (double x : us) sum += x;
    const double mean = sum / double(ticks);
    auto pct = [&](double p) { return sorted[std::min(ticks - 1, size_t(p * double(ticks)))]; };
    std::printf(
        "live_bench: %zu tags, %zu sessions x %zu subscribed, change %.0f%%, %zu ticks at "
        "%.1f Hz\n",
        tags, sessions, subs, changePct, ticks, hz);
    std::printf("  tick: mean %.1f us, p50 %.1f, p99 %.1f, max %.1f; %.2f %% of one core\n", mean,
                pct(0.5), pct(0.99), sorted.back(), mean * hz / 1e4);
    std::printf(
        "  out: %.1f messages/tick, %.0f B/tick; store updates %.1f us/tick (not counted)\n",
        double(tx.messages) / double(ticks), double(tx.bytes) / double(ticks),
        updateUs / double(ticks));
    return 0;
}
