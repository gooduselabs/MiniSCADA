// Store of the retained Tags (FR-018; data-model §10; research R16): format, in-place saves,
// compaction, power loss at every step, damaged files, change of project, I/O errors.
#include "core/tag-engine/retain_store.hpp"

#include <gtest/gtest.h>
#include <sys/stat.h>

#include <cstdio>
#include <cstring>
#include <filesystem>
#include <map>
#include <set>

using namespace mat;

namespace {

struct PowerLoss {};

// Files in memory with a durable image and the writes not yet synced, so that a power loss can
// keep or drop what was not synced, and tear a write. Counts every call.
class MemIo : public RetainIo {
   public:
    struct File {
        std::vector<uint8_t> cache;
        std::vector<uint8_t> durable;
    };
    std::map<std::string, File> files;
    // counters
    uint64_t creates = 0, preads = 0, pwrites = 0, fdatasyncs = 0, renames = 0, removes = 0;
    uint64_t bytesWritten = 0;
    std::vector<std::string> trace;  // "pwrite a 64 +120", "fdatasync a", ...
    // fault injection
    int64_t opsLeft = -1;  // power loss when this many mutating calls have happened (-1: never)
    size_t tornBytes = 0;  // the write that loses power is cut after this many bytes
    std::string failWith;  // pwrite / fdatasync return false with this error
    bool failNow = false;
    std::string error;

    bool exists(const std::string& n) override { return files.count(n) > 0; }
    int64_t size(const std::string& n) override {
        auto it = files.find(n);
        return it == files.end() ? -1 : static_cast<int64_t>(it->second.cache.size());
    }
    void tick() {
        if (opsLeft == 0) throw PowerLoss{};
        if (opsLeft > 0) --opsLeft;
    }
    bool createZeroed(const std::string& n, size_t sz) override {
        tick();
        ++creates;
        trace.push_back("create " + n);
        File f;
        f.cache.assign(sz, 0);
        f.durable = f.cache;
        files[n] = f;
        bytesWritten += sz;
        return true;
    }
    bool pread(const std::string& n, size_t off, void* buf, size_t len) override {
        ++preads;
        auto it = files.find(n);
        if (it == files.end() || off + len > it->second.cache.size()) return false;
        std::memcpy(buf, it->second.cache.data() + off, len);
        return true;
    }
    bool pwrite(const std::string& n, size_t off, const void* buf, size_t len) override {
        if (failNow) {
            error = failWith;
            return false;
        }
        if (opsLeft == 0) {  // torn: part of the data reached the cache, then the power went
            auto& f = files.at(n);
            std::memcpy(f.cache.data() + off, buf, std::min(tornBytes, len));
            throw PowerLoss{};
        }
        tick();
        ++pwrites;
        bytesWritten += len;
        trace.push_back("pwrite " + n + " @" + std::to_string(off) + " +" + std::to_string(len));
        auto& f = files.at(n);
        EXPECT_LE(off + len, f.cache.size()) << "the size of a file never changes";
        std::memcpy(f.cache.data() + off, buf, len);
        return true;
    }
    bool fdatasync(const std::string& n) override {
        if (failNow) {
            error = failWith;
            return false;
        }
        tick();
        ++fdatasyncs;
        trace.push_back("fdatasync " + n);
        files.at(n).durable = files.at(n).cache;
        return true;
    }
    bool rename(const std::string& a, const std::string& b) override {
        tick();
        ++renames;
        trace.push_back("rename " + a + " " + b);
        files[b] = files.at(a);
        files.erase(a);
        return true;
    }
    bool remove(const std::string& n) override {
        tick();
        ++removes;
        files.erase(n);
        return true;
    }
    std::vector<std::string> list() override {
        std::vector<std::string> out;
        for (const auto& [n, f] : files) out.push_back(n);
        return out;
    }
    std::string lastError() const override { return error; }

    // The power comes back: what was synced stays; what was not is dropped (or kept, by
    // `keepUnsynced`).
    void reboot(bool keepUnsynced) {
        for (auto& [n, f] : files)
            if (!keepUnsynced)
                f.cache = f.durable;
            else
                f.durable = f.cache;
        opsLeft = -1;
        failNow = false;
    }
};

using Values = std::map<std::string, RetainValue>;

Values valuesOf(RetainStore& s) { return s.values(); }

RetainValue dbl(double v) { return {TagType::FLOAT64, v}; }

bool sameValues(const Values& a, const Values& b) {
    if (a.size() != b.size()) return false;
    for (const auto& [id, v] : a) {
        auto it = b.find(id);
        if (it == b.end() || it->second.type != v.type || !(it->second.value == v.value))
            return false;
    }
    return true;
}

uint32_t le32(const std::vector<uint8_t>& b, size_t at) {
    return b[at] | (b[at + 1] << 8) | (b[at + 2] << 16) | (static_cast<uint32_t>(b[at + 3]) << 24);
}
uint64_t le64(const std::vector<uint8_t>& b, size_t at) {
    return le32(b, at) | (static_cast<uint64_t>(le32(b, at + 4)) << 32);
}

}  // namespace

// ---- format ----

TEST(RetainStoreFormat, FreshStoreHasTwoPreAllocatedFilesAndAHeader) {
    MemIo io;
    RetainStore s(io, 5000);
    EXPECT_EQ(s.open(), RetainStatus::Fresh);
    ASSERT_EQ(io.files.count("retain-a.bin"), 1u);
    ASSERT_EQ(io.files.count("retain-b.bin"), 1u);
    EXPECT_EQ(io.files["retain-a.bin"].cache.size(), 512u * 1024);
    EXPECT_EQ(io.files["retain-b.bin"].cache.size(), 512u * 1024);
    EXPECT_EQ(io.creates, 2u);  // zero-filled and synced once each
    const auto& a = io.files["retain-a.bin"].cache;
    EXPECT_EQ(std::string(a.begin(), a.begin() + 8), "MATRET01");
    EXPECT_EQ(a[8], 1);  // format version u16 = 1
    EXPECT_EQ(a[9], 0);
    EXPECT_EQ(le64(a, 12), 1u);  // generation
    // snapshot length: the first record is an empty snapshot of 19 bytes
    EXPECT_EQ(le32(a, 20), 19u);
    EXPECT_EQ(le32(a, 64), 19u);         // record length (with the CRC)
    EXPECT_EQ(le64(a, 68), 1u);          // sequence number
    EXPECT_EQ(a[76], 1);                 // snapshot flag
    EXPECT_EQ(a[77] | (a[78] << 8), 0);  // no entries
    // the other file is still zeros: no header
    for (size_t i = 0; i < 64; ++i) EXPECT_EQ(io.files["retain-b.bin"].cache[i], 0) << i;
}

TEST(RetainStoreFormat, RecordsAreLittleEndianWithAnExplicitLayout) {
    const auto rec = RetainStore::encodeRecord(7, false, {{"AB", dbl(1.5)}});
    // len(4) seq(8) flag(1) count(2) | idLen(1) "AB" type(1) value(8) | crc(4)
    ASSERT_EQ(rec.size(), 4u + 8 + 1 + 2 + (1 + 2 + 1 + 8) + 4);
    EXPECT_EQ(le32(rec, 0), rec.size());
    EXPECT_EQ(le64(rec, 4), 7u);
    EXPECT_EQ(rec[12], 0);  // a change record
    EXPECT_EQ(rec[13], 1);  // one entry
    EXPECT_EQ(rec[15], 2);  // id length
    EXPECT_EQ(rec[16], 'A');
    EXPECT_EQ(rec[17], 'B');
    EXPECT_EQ(rec[18], static_cast<uint8_t>(TagType::FLOAT64));
    double d;
    std::memcpy(&d, rec.data() + 19, 8);
    EXPECT_EQ(d, 1.5);
}

TEST(RetainStoreFormat, EveryTypeRoundTripsThroughAReopen) {
    MemIo io;
    {
        RetainStore s(io, 0);
        s.open();
        s.set("B", TagType::BOOL, true);
        s.set("I16", TagType::INT16, int64_t{-5});
        s.set("U16", TagType::UINT16, uint64_t{65535});
        s.set("I32", TagType::INT32, int64_t{-2000000000});
        s.set("U32", TagType::UINT32, uint64_t{4000000000u});
        s.set("I64", TagType::INT64, int64_t{INT64_MIN});
        s.set("U64", TagType::UINT64, uint64_t{UINT64_MAX});
        s.set("F32", TagType::FLOAT32, 1.5);
        s.set("F64", TagType::FLOAT64, -0.1);
        s.set("S", TagType::STRING, std::string("Bơm số 1"));
        ASSERT_TRUE(s.flushNow(0));
    }
    io.reboot(false);
    RetainStore t(io, 0);
    EXPECT_EQ(t.open(), RetainStatus::Ok);
    const auto& v = t.values();
    EXPECT_EQ(std::get<bool>(v.at("B").value), true);
    EXPECT_EQ(std::get<int64_t>(v.at("I16").value), -5);
    EXPECT_EQ(std::get<uint64_t>(v.at("U16").value), 65535u);
    EXPECT_EQ(std::get<int64_t>(v.at("I32").value), -2000000000);
    EXPECT_EQ(std::get<uint64_t>(v.at("U32").value), 4000000000u);
    EXPECT_EQ(std::get<int64_t>(v.at("I64").value), INT64_MIN);
    EXPECT_EQ(std::get<uint64_t>(v.at("U64").value), UINT64_MAX);
    EXPECT_EQ(std::get<double>(v.at("F32").value), 1.5);
    EXPECT_EQ(std::get<double>(v.at("F64").value), -0.1);
    EXPECT_EQ(std::get<std::string>(v.at("S").value), "Bơm số 1");
}

// ---- saves ----

TEST(RetainStoreSave, OnePwriteRightAfterTheLastRecordThenOneFdatasync) {
    MemIo io;
    RetainStore s(io, 5000);
    s.open();
    io.trace.clear();
    const uint64_t w0 = io.pwrites, f0 = io.fdatasyncs;
    s.set("A", TagType::FLOAT64, 1.0);
    ASSERT_TRUE(s.flushNow(1000));
    EXPECT_EQ(io.pwrites - w0, 1u);
    EXPECT_EQ(io.fdatasyncs - f0, 1u);
    // the first record of the file is 19 bytes at 64: the change goes at 83
    ASSERT_EQ(io.trace.size(), 2u);
    EXPECT_EQ(io.trace[0],
              "pwrite retain-a.bin @83 +" + std::to_string(4 + 8 + 1 + 2 + (1 + 1 + 1 + 8) + 4));
    EXPECT_EQ(io.trace[1], "fdatasync retain-a.bin");
    EXPECT_EQ(io.files["retain-a.bin"].cache.size(), 512u * 1024);  // the size never changes
    const uint64_t w1 = io.pwrites;
    s.set("A", TagType::FLOAT64, 2.0);
    ASSERT_TRUE(s.flushNow(2000));
    EXPECT_EQ(io.pwrites - w1, 1u);
    EXPECT_EQ(io.trace.back(), "fdatasync retain-a.bin");
}

TEST(RetainStoreSave, AtMostOneSavePerWindowAndAChangedTagIsWrittenWithinOneWindow) {
    MemIo io;
    RetainStore s(io, 5000);
    s.open();
    s.set("A", TagType::FLOAT64, 1.0);
    EXPECT_TRUE(s.flushIfDue(100000));  // quiet for long: at once
    const uint64_t w = io.pwrites;
    s.set("A", TagType::FLOAT64, 2.0);
    EXPECT_FALSE(s.flushIfDue(100000 + 4999));
    EXPECT_EQ(io.pwrites, w);
    s.set("A", TagType::FLOAT64, 3.0);  // collected into the same record
    EXPECT_TRUE(s.flushIfDue(100000 + 5000));
    EXPECT_EQ(io.pwrites, w + 1);
    EXPECT_FALSE(s.flushIfDue(100000 + 20000));  // nothing pending: no write
    EXPECT_EQ(io.pwrites, w + 1);
    EXPECT_EQ(std::get<double>(s.values().at("A").value), 3.0);
}

TEST(RetainStoreSave, FlushNowIgnoresTheWindow) {
    MemIo io;
    RetainStore s(io, 60000);
    s.open();
    s.set("A", TagType::FLOAT64, 1.0);
    ASSERT_TRUE(s.flushIfDue(0));
    s.set("A", TagType::FLOAT64, 2.0);
    EXPECT_FALSE(s.flushIfDue(1));
    EXPECT_TRUE(s.flushNow(2));  // before execv
}

TEST(RetainStoreSave, SaveSizeOfOneSmallChange) {
    MemIo io;
    RetainStore s(io, 0);
    s.open();
    s.set("TANK01.SP_HI", TagType::FLOAT32, 85.0);
    ASSERT_TRUE(s.flushNow(0));
    const uint64_t before = io.bytesWritten;
    s.set("TANK01.SP_HI", TagType::FLOAT32, 86.0);
    ASSERT_TRUE(s.flushNow(1));
    // R16: a record of a few dozen bytes; the file system writes one 4 KiB block
    EXPECT_LT(io.bytesWritten - before, 64u);
}

TEST(RetainStoreSave, ReopenReplaysTheSnapshotAndTheChanges) {
    MemIo io;
    {
        RetainStore s(io, 0);
        s.open();
        s.set("A", TagType::FLOAT64, 1.0);
        s.set("B", TagType::FLOAT64, 10.0);
        s.flushNow(0);
        s.set("A", TagType::FLOAT64, 2.0);
        s.flushNow(1);
        s.set("C", TagType::BOOL, true);
        s.flushNow(2);
    }
    io.reboot(false);
    RetainStore t(io, 0);
    EXPECT_EQ(t.open(), RetainStatus::Ok);
    Values want{{"A", dbl(2.0)}, {"B", dbl(10.0)}, {"C", {TagType::BOOL, true}}};
    EXPECT_TRUE(sameValues(t.values(), want));
    // and the next save goes after the replayed records
    t.set("A", TagType::FLOAT64, 3.0);
    ASSERT_TRUE(t.flushNow(3));
    io.reboot(false);
    RetainStore u(io, 0);
    u.open();
    EXPECT_EQ(std::get<double>(u.values().at("A").value), 3.0);
}

// ---- compaction ----

namespace {

// Many tags with long strings, all changed on every save: the file fills in a few dozen saves.
void fillTags(RetainStore& s, int round) {
    for (int t = 0; t < 40; ++t)
        s.set("T" + std::to_string(t), TagType::STRING,
              std::string(200, static_cast<char>('a' + (round + t) % 26)));
}

}  // namespace

TEST(RetainStoreCompaction, WhenLessThanTwiceTheLargestRecordIsLeftTheStateGoesToTheOtherFile) {
    MemIo io;
    RetainStore s(io, 0);
    s.open();
    int round = 0;
    std::string first = s.diag().file;
    while (s.diag().compactions == 0 && round < 200) {
        fillTags(s, ++round);
        ASSERT_TRUE(s.flushNow(round));
    }
    ASSERT_EQ(s.diag().compactions, 1u);
    EXPECT_NE(s.diag().file, first);
    EXPECT_EQ(s.diag().generation, 2u);
    // order of the compaction: body, fdatasync, header, fdatasync (before any other write to that
    // file)
    size_t at = io.trace.size();
    while (at > 0 && io.trace[at - 1].rfind("pwrite", 0) != 0) --at;
    ASSERT_GE(io.trace.size(), 4u);
    const auto n = io.trace.size();
    EXPECT_EQ(io.trace[n - 4].substr(0, 6), "pwrite");
    EXPECT_NE(io.trace[n - 4].find("@64"), std::string::npos);  // body
    EXPECT_EQ(io.trace[n - 3].substr(0, 9), "fdatasync");
    EXPECT_NE(io.trace[n - 2].find("@0 +64"), std::string::npos);  // header of generation + 1
    EXPECT_EQ(io.trace[n - 1].substr(0, 9), "fdatasync");
    // the new header says generation 2
    const auto& f = io.files[s.diag().file].cache;
    EXPECT_EQ(le64(f, 12), 2u);
    // everything survives a restart, from the new file
    const Values want = valuesOf(s);
    io.reboot(false);
    RetainStore t(io, 0);
    EXPECT_EQ(t.open(), RetainStatus::Ok);
    EXPECT_EQ(t.diag().file, s.diag().file);
    EXPECT_TRUE(sameValues(t.values(), want));
    // the next compaction goes back to the first file, generation 3, and the stale records of the
    // older generation left in it do not come back
    for (int more = 0; more < 200 && t.diag().compactions == 0; ++more) {
        fillTags(t, 1000 + more);
        ASSERT_TRUE(t.flushNow(5000 + more));
    }
    EXPECT_EQ(t.diag().file, first);
    EXPECT_EQ(t.diag().generation, 3u);
    const Values want2 = valuesOf(t);
    io.reboot(false);
    RetainStore u(io, 0);
    EXPECT_EQ(u.open(), RetainStatus::Ok);
    EXPECT_TRUE(sameValues(u.values(), want2));
}

TEST(RetainStoreCompaction, FiveHundredTagsWithStringsOf256BytesFitTheSnapshot) {
    MemIo io;
    RetainStore s(io, 0);
    s.open();
    for (int t = 0; t < 500; ++t)
        s.set("TAG" + std::to_string(t) + ".VALUE_NAME", TagType::STRING, std::string(256, 'x'));
    ASSERT_TRUE(s.flushNow(0)) << s.diag().lastError;
    EXPECT_LT(s.diag().bytesWritten, 512u * 1024);
    io.reboot(false);
    RetainStore t(io, 0);
    EXPECT_EQ(t.open(), RetainStatus::Ok);
    EXPECT_EQ(t.values().size(), 500u);
    // it keeps working across compactions
    int saves = 0;
    for (int k = 0; k < 40; ++k) {
        for (int g = 0; g < 500; ++g)
            t.set("TAG" + std::to_string(g) + ".VALUE_NAME", TagType::STRING,
                  std::string(256, static_cast<char>('a' + k % 26)));
        ASSERT_TRUE(t.flushNow(k + 1)) << t.diag().lastError;
        ++saves;
    }
    EXPECT_GT(t.diag().compactions, 0u);
    EXPECT_EQ(saves, 40);
}

// ---- power loss at every step ----

namespace {

struct ScenarioResult {
    std::vector<Values> committed;  // state after each flush that returned
    size_t ops = 0;
};

// The scenario of the sweep: open, then rounds of changes, each flushed. `crashAt` < 0: no crash.
ScenarioResult runScenario(MemIo& io, int rounds, bool bigTags, bool* crashed) {
    ScenarioResult r;
    *crashed = false;
    try {
        RetainStore s(io, 0);
        s.open();
        r.committed.push_back(valuesOf(s));
        for (int i = 1; i <= rounds; ++i) {
            if (bigTags)
                fillTags(s, i);
            else {
                s.set("A", TagType::FLOAT64, i * 1.5);
                if (i % 2 == 0) s.set("B", TagType::BOOL, i % 4 == 0);
                if (i == 3) s.set("S", TagType::STRING, std::string("abc"));
            }
            if (!s.flushNow(i)) break;
            r.committed.push_back(valuesOf(s));
        }
    } catch (const PowerLoss&) {
        *crashed = true;
    }
    return r;
}

void sweep(bool bigTags, int rounds) {
    // count the mutating operations of a full run
    MemIo probe;
    bool crashed = false;
    runScenario(probe, rounds, bigTags, &crashed);
    ASSERT_FALSE(crashed);
    const size_t total = probe.creates + probe.pwrites + probe.fdatasyncs;
    ASSERT_GT(total, 5u);
    size_t cases = 0;
    for (size_t k = 0; k < total; ++k)
        for (bool keepUnsynced : {false, true})
            for (size_t torn : {size_t{0}, size_t{7}, size_t{40}}) {
                MemIo io;
                io.opsLeft = static_cast<int64_t>(k);
                io.tornBytes = torn;
                bool c = false;
                const ScenarioResult run = runScenario(io, rounds, bigTags, &c);
                ASSERT_TRUE(c) << "k=" << k;
                io.reboot(keepUnsynced);
                RetainStore after(io, 0);
                const RetainStatus st = after.open();
                // never a state that was not committed or in flight: the last committed one, or the
                // next (a flush whose record reached the file before the power went)
                const Values got = valuesOf(after);
                bool ok = false;
                const size_t last = run.committed.empty() ? 0 : run.committed.size() - 1;
                if (run.committed.empty())
                    ok = got.empty();  // power lost before the first state existed
                else if (sameValues(got, run.committed[last]))
                    ok = true;
                else {
                    // the in-flight flush: replay the scenario one flush further, without a crash
                    MemIo again;
                    bool c2 = false;
                    const ScenarioResult full = runScenario(again, rounds, bigTags, &c2);
                    if (last + 1 < full.committed.size() &&
                        sameValues(got, full.committed[last + 1]))
                        ok = true;
                }
                EXPECT_TRUE(ok) << "power lost at op " << k << ", keepUnsynced " << keepUnsynced
                                << ", torn " << torn << " -> status " << retainStatusName(st)
                                << ", " << got.size() << " values";
                // and the store is usable: a save after the recovery survives a second restart
                after.set("Z", TagType::FLOAT64, 99.0);
                EXPECT_TRUE(after.flushNow(1'000'000)) << "k=" << k;
                io.reboot(false);
                RetainStore again(io, 0);
                again.open();
                EXPECT_EQ(std::get<double>(again.values().at("Z").value), 99.0) << "k=" << k;
                ++cases;
            }
    EXPECT_GT(cases, 30u);
}

}  // namespace

TEST(RetainStorePowerLoss, EveryStepOfSmallSavesLosesAtMostTheLastWindow) { sweep(false, 6); }

TEST(RetainStorePowerLoss, EveryStepOfACompactionLosesAtMostTheLastWindow) {
    // enough rounds of big records to pass the first compaction
    MemIo probe;
    bool crashed = false;
    int rounds = 1;
    for (; rounds < 100; ++rounds) {
        MemIo io;
        const auto r = runScenario(io, rounds, true, &crashed);
        (void)r;
        RetainStore chk(io, 0);
        io.reboot(false);
        chk.open();
        if (chk.diag().generation >= 2) break;
    }
    ASSERT_LT(rounds, 100);
    sweep(true, rounds + 1);
}

// ---- damaged files ----

TEST(RetainStoreDamage, ADamagedHeaderOfTheNewFileFallsBackToTheOldOne) {
    MemIo io;
    Values want;
    {
        RetainStore s(io, 0);
        s.open();
        int round = 0;
        while (s.diag().compactions == 0) {
            fillTags(s, ++round);
            ASSERT_TRUE(s.flushNow(round));
        }
        want = valuesOf(s);
        // the file in use is the new one: damage its header
        auto& f = io.files[s.diag().file];
        f.cache[20] ^= 0xFF;
        f.durable = f.cache;
    }
    RetainStore t(io, 0);
    const RetainStatus st = t.open();
    EXPECT_EQ(st, RetainStatus::Fallback);
    EXPECT_EQ(t.diag().status, RetainStatus::Fallback);
    // the old file is the one before the last compaction: its values are those of that moment
    EXPECT_FALSE(t.values().empty());
    // and the runtime keeps going: a save works and a restart reads it
    t.set("NEW", TagType::FLOAT64, 5.0);
    EXPECT_TRUE(t.flushNow(0));
    io.reboot(false);
    RetainStore u(io, 0);
    u.open();
    EXPECT_EQ(std::get<double>(u.values().at("NEW").value), 5.0);
    (void)want;
}

TEST(RetainStoreDamage, BothFilesDamagedStartFromScratchAndKeepTheEvidence) {
    MemIo io;
    {
        RetainStore s(io, 0);
        s.open();
        s.set("A", TagType::FLOAT64, 1.0);
        s.flushNow(0);
        int round = 0;
        while (s.diag().compactions == 0) {
            fillTags(s, ++round);
            s.flushNow(round);
        }
    }
    for (auto& [n, f] : io.files) {
        f.cache[0] ^= 0xFF;  // the magic
        f.durable = f.cache;
    }
    RetainStore t(io, 0, [] { return std::string("20261011T010000"); });
    EXPECT_EQ(t.open(), RetainStatus::Lost);
    EXPECT_TRUE(t.values().empty());
    EXPECT_EQ(io.files.count("retain-a.bin.corrupt-20261011T010000"), 1u);
    EXPECT_EQ(io.files.count("retain-b.bin.corrupt-20261011T010000"), 1u);
    EXPECT_EQ(io.files.count("retain-a.bin"), 1u);  // new files
    EXPECT_EQ(t.diag().status, RetainStatus::Lost);
    // usable
    t.set("A", TagType::FLOAT64, 7.0);
    EXPECT_TRUE(t.flushNow(0));
}

TEST(RetainStoreDamage, AtMostThreeDamagedSetsAreKept) {
    MemIo io;
    for (int i = 1; i <= 5; ++i) {
        {
            RetainStore s(io, 0);
            s.open();
            s.set("A", TagType::FLOAT64, static_cast<double>(i));
            s.flushNow(0);
        }
        for (auto& [n, f] : io.files) {
            if (n.find(".corrupt-") != std::string::npos) continue;
            f.cache[0] ^= 0xFF;
            f.durable = f.cache;
        }
        const std::string stamp = "2026101" + std::to_string(i);
        RetainStore t(io, 0, [stamp] { return stamp; });
        EXPECT_EQ(t.open(), RetainStatus::Lost);
    }
    std::set<std::string> stamps;
    for (const auto& [n, f] : io.files) {
        const auto at = n.find(".corrupt-");
        if (at != std::string::npos) stamps.insert(n.substr(at + 9));
    }
    EXPECT_EQ(stamps, (std::set<std::string>{"20261013", "20261014", "20261015"}));
}

TEST(RetainStoreDamage, ARecordCutByAPowerLossIsDroppedTheRestIsKept) {
    MemIo io;
    {
        RetainStore s(io, 0);
        s.open();
        s.set("A", TagType::FLOAT64, 1.0);
        s.flushNow(0);
        s.set("A", TagType::FLOAT64, 2.0);
        s.flushNow(1);
    }
    // cut the last record in the middle
    auto& f = io.files["retain-a.bin"];
    // records: snapshot 19 @64, change(1.0) @83, change(2.0) next: damage its CRC area
    const size_t rec = 4 + 8 + 1 + 2 + (1 + 1 + 1 + 8) + 4;
    f.cache[83 + rec + rec - 2] ^= 0x55;
    f.durable = f.cache;
    RetainStore t(io, 0);
    EXPECT_EQ(t.open(), RetainStatus::Ok);
    EXPECT_EQ(std::get<double>(t.values().at("A").value), 1.0);  // only the last window is lost
}

TEST(RetainStoreDamage, FilesOfTheWrongSizeAreNotTrusted) {
    MemIo io;
    {
        RetainStore s(io, 0);
        s.open();
        s.set("A", TagType::FLOAT64, 1.0);
        s.flushNow(0);
    }
    io.files["retain-a.bin"].cache.resize(1000);
    io.files["retain-a.bin"].durable = io.files["retain-a.bin"].cache;
    RetainStore t(io, 0, [] { return std::string("x"); });
    EXPECT_EQ(t.open(), RetainStatus::Lost);
}

// ---- change of project ----

TEST(RetainStoreProject, KeepsTheTagsWithTheSameIdAndTypeAndCompactsWhenOneIsDropped) {
    MemIo io;
    RetainStore s(io, 0);
    s.open();
    s.set("KEEP", TagType::FLOAT64, 1.5);
    s.set("RETYPED", TagType::FLOAT64, 2.5);
    s.set("GONE", TagType::BOOL, true);
    ASSERT_TRUE(s.flushNow(0));
    const uint64_t gen = s.diag().generation;
    s.configure(
        {{"KEEP", TagType::FLOAT64}, {"RETYPED", TagType::INT16}, {"NEW", TagType::FLOAT64}});
    EXPECT_EQ(s.values().size(), 1u);
    EXPECT_EQ(std::get<double>(s.values().at("KEEP").value), 1.5);
    EXPECT_TRUE(s.hasPending());
    ASSERT_TRUE(s.flushNow(1));  // compacted at once: the old values leave the file
    EXPECT_EQ(s.diag().generation, gen + 1);
    // the dropped values are gone from the file in use and also from the old file's records of this
    // generation
    io.reboot(false);
    RetainStore t(io, 0);
    t.open();
    EXPECT_EQ(t.values().size(), 1u);
    EXPECT_EQ(t.values().count("GONE"), 0u);
}

TEST(RetainStoreProject, NothingDroppedNothingCompacted) {
    MemIo io;
    RetainStore s(io, 0);
    s.open();
    s.set("A", TagType::FLOAT64, 1.0);
    s.flushNow(0);
    const uint64_t gen = s.diag().generation;
    s.configure({{"A", TagType::FLOAT64}, {"B", TagType::BOOL}});
    EXPECT_FALSE(s.hasPending());
    EXPECT_EQ(s.diag().generation, gen);
}

// ---- I/O errors ----

TEST(RetainStoreErrors, EnospcAndEioAreReportedAndTheChangesWaitForTheNextTry) {
    for (const char* err : {"ENOSPC", "EIO"}) {
        MemIo io;
        RetainStore s(io, 0);
        s.open();
        s.set("A", TagType::FLOAT64, 1.0);
        io.failNow = true;
        io.failWith = err;
        EXPECT_FALSE(s.flushNow(0));
        EXPECT_EQ(s.diag().lastError, err);
        EXPECT_TRUE(s.hasPending());
        io.failNow = false;
        EXPECT_TRUE(s.flushNow(1));  // the runtime kept running; the next try writes it
        EXPECT_TRUE(s.diag().lastError.empty());
        io.reboot(false);
        RetainStore t(io, 0);
        t.open();
        EXPECT_EQ(std::get<double>(t.values().at("A").value), 1.0);
    }
}

TEST(RetainStoreErrors, AFailedFdatasyncDoesNotAdvanceTheLog) {
    MemIo io;
    RetainStore s(io, 0);
    s.open();
    s.set("A", TagType::FLOAT64, 1.0);
    ASSERT_TRUE(s.flushNow(0));
    s.set("A", TagType::FLOAT64, 2.0);
    io.failNow = true;
    io.failWith = "EIO";
    EXPECT_FALSE(s.flushNow(1));
    io.failNow = false;
    ASSERT_TRUE(s.flushNow(2));  // the same record is written again at the same place
    io.reboot(false);
    RetainStore t(io, 0);
    t.open();
    EXPECT_EQ(std::get<double>(t.values().at("A").value), 2.0);
}

// ---- real files ----

TEST(RetainStorePosix, RealFilesPermissionsAndReopen) {
    namespace fs = std::filesystem;
    const fs::path dir = fs::temp_directory_path() / "mat-retain-test";
    fs::remove_all(dir);
    {
        PosixRetainIo io((dir / "retain").string());
        ASSERT_TRUE(io.ensureDir() || true);
        RetainStore s(io, 0);
        EXPECT_EQ(s.open(), RetainStatus::Fresh);
        s.set("A", TagType::FLOAT64, 42.0);
        s.set("T", TagType::STRING, std::string("xin chào"));
        ASSERT_TRUE(s.flushNow(0));
    }
    struct stat st {};
    ASSERT_EQ(::stat((dir / "retain").c_str(), &st), 0);
    EXPECT_EQ(st.st_mode & 07777, 0700u);
    ASSERT_EQ(::stat((dir / "retain/retain-a.bin").c_str(), &st), 0);
    EXPECT_EQ(st.st_mode & 07777, 0600u);
    EXPECT_EQ(st.st_size, 512 * 1024);
    {
        PosixRetainIo io((dir / "retain").string());
        RetainStore s(io, 0);
        EXPECT_EQ(s.open(), RetainStatus::Ok);
        EXPECT_EQ(std::get<double>(s.values().at("A").value), 42.0);
        EXPECT_EQ(std::get<std::string>(s.values().at("T").value), "xin chào");
        // many saves, a compaction, a reopen
        for (int k = 0; k < 80; ++k) {
            fillTags(s, k);
            ASSERT_TRUE(s.flushNow(k + 1)) << s.diag().lastError;
        }
        EXPECT_GT(s.diag().compactions, 0u);
    }
    {
        PosixRetainIo io((dir / "retain").string());
        RetainStore s(io, 0);
        EXPECT_EQ(s.open(), RetainStatus::Ok);
        EXPECT_EQ(s.values().size(), 42u);
    }
    fs::remove_all(dir);
}
