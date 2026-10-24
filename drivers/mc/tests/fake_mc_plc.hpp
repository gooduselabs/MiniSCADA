// A fake Mitsubishi PLC for the MC driver tests (feature 017): memory per (station, device), the
// answer to 0401/1401/0403 in 3E/4E, binary/ASCII (contracts/mc-protocol.md), faults on command,
// and a fake transport on the fake clock (drivers/modbus/tests/fake_plc.hpp FakeClock) that
// delivers the answer after a latency, in one or several pieces, or as one datagram (UDP).
#pragma once
#include <algorithm>
#include <cstdint>
#include <deque>
#include <functional>
#include <map>
#include <mutex>
#include <set>
#include <string>
#include <vector>

#include "drivers/mc/mc_frame.hpp"
#include "drivers/modbus/tests/fake_plc.hpp"  // FakeClock
#include "drivers/sdk/transport.hpp"

namespace mat::testing {

using McBytes = std::vector<uint8_t>;

struct McFault {
    enum Kind { Silent, EndCode, Delay, Close, Garbage, BadRoute, BadSerial, Truncate, Split };
    Kind kind = Silent;
    uint16_t code = 0xC056;
    int64_t delayMs = 0;
    int station = -1;            // only requests to this PC no (-1: any)
    int device = -1;             // only this device (mc::Device as int; -1: any)
    int64_t from = -1, to = -1;  // only requests touching this word/point range
    int cmd = -1;                // only this command (0x0401...)
    int count = 1;
};

struct McPlcRequest {
    int station = 0;
    uint16_t cmd = 0, sub = 0;
    int device = -1;
    uint32_t number = 0;
    int points = 0;
    int randomWords = 0, randomDwords = 0;
    uint16_t serial = 0;
    int64_t atMs = 0;
};

struct McReply {
    std::vector<McBytes> pieces;
    int64_t delayMs = 0;
    bool close = false;
};

class FakeMcPlc {
   public:
    // Stations that answer (PC no); others are silent.
    std::set<int> stations = {255};
    std::set<int> mute;                 // stations that never answer
    bool responding = true;             // false: nothing answers (a pulled cable)
    bool refuse = false;                // connect() is refused
    uint32_t deviceSize = 100000;       // points/words per device; beyond: C056
    std::map<int, uint16_t> badDevice;  // device -> end code for any access
    uint64_t bytesIn = 0, bytesOut = 0;
    int connectAttempts = 0, connections = 0;
    int dropEpoch = 0;

    void setWord(int station, mc::Device d, uint32_t n, uint16_t v) {
        std::lock_guard<std::mutex> g(mu);
        words[{station, static_cast<int>(d)}][n] = v;
    }
    void setWords(int station, mc::Device d, uint32_t n, const std::vector<uint16_t>& v) {
        for (size_t i = 0; i < v.size(); ++i)
            setWord(station, d, n + static_cast<uint32_t>(i), v[i]);
    }
    uint16_t word(int station, mc::Device d, uint32_t n) {
        std::lock_guard<std::mutex> g(mu);
        return wordLocked(station, static_cast<int>(d), n);
    }
    // a bit device point (stored 16 per word, like the PLC's memory seen by word reads)
    void setBit(int station, mc::Device d, uint32_t p, bool on) {
        std::lock_guard<std::mutex> g(mu);
        uint16_t& w = words[{station, static_cast<int>(d)}][p / 16];
        w = static_cast<uint16_t>(on ? (w | (1u << (p % 16))) : (w & ~(1u << (p % 16))));
    }
    bool bit(int station, mc::Device d, uint32_t p) {
        std::lock_guard<std::mutex> g(mu);
        return (wordLocked(station, static_cast<int>(d), p / 16) >> (p % 16)) & 1;
    }
    void addFault(McFault f) {
        std::lock_guard<std::mutex> g(mu);
        faults.push_back(f);
    }
    std::vector<McPlcRequest> requests() {
        std::lock_guard<std::mutex> g(mu);
        return log;
    }
    void clearLog() {
        std::lock_guard<std::mutex> g(mu);
        log.clear();
    }

    McReply handle(const McBytes& req, int64_t now) {
        std::lock_guard<std::mutex> g(mu);
        McReply out;
        Parsed p;
        if (!parse(req, p)) return out;  // not a request: silent
        McPlcRequest entry;
        entry.station = p.route.station;
        entry.cmd = p.cmd;
        entry.sub = p.sub;
        entry.serial = p.serial;
        entry.atMs = now;
        if (!p.points.empty()) {
            entry.device = p.points[0].dev;
            entry.number = p.points[0].number;
        }
        entry.points = p.count;
        entry.randomWords = p.nWords;
        entry.randomDwords = p.nDwords;
        log.push_back(entry);
        if (!responding || mute.count(p.route.station) || !stations.count(p.route.station))
            return out;
        // faults
        uint16_t endCode = 0;
        int64_t delay = 0;
        bool garbage = false, badRoute = false, badSerial = false, truncate = false, split = false;
        for (auto it = faults.begin(); it != faults.end();) {
            if (!matches(*it, p)) {
                ++it;
                continue;
            }
            switch (it->kind) {
                case McFault::Silent:
                    consume(it);
                    return out;
                case McFault::Close:
                    consume(it);
                    out.close = true;
                    return out;
                case McFault::EndCode:
                    endCode = it->code;
                    break;
                case McFault::Delay:
                    delay = it->delayMs;
                    break;
                case McFault::Garbage:
                    garbage = true;
                    break;
                case McFault::BadRoute:
                    badRoute = true;
                    break;
                case McFault::BadSerial:
                    badSerial = true;
                    break;
                case McFault::Truncate:
                    truncate = true;
                    break;
                case McFault::Split:
                    split = true;
                    break;
            }
            if (consume(it)) continue;
        }
        out.delayMs = delay;
        if (garbage) {
            out.pieces.push_back({0xFF, 0x13, 0x37, 0x00});
            return out;
        }
        McBytes data;
        if (endCode == 0) endCode = execute(p, data);
        if (badRoute) p.route.station = static_cast<uint8_t>(p.route.station ^ 0x01);
        if (badSerial) p.serial = static_cast<uint16_t>(p.serial + 1);
        McBytes frame = encode(p, endCode, data);
        if (truncate) frame.resize(frame.size() > 3 ? frame.size() - 3 : 1);
        if (split && frame.size() > 4) {
            out.pieces.push_back(McBytes(frame.begin(), frame.begin() + 4));
            out.pieces.push_back(McBytes(frame.begin() + 4, frame.end()));
        } else {
            out.pieces.push_back(std::move(frame));
        }
        return out;
    }

    std::mutex mu;

   private:
    struct Point {
        int dev = 0;
        uint32_t number = 0;
    };
    struct Parsed {
        mc::FrameType frame = mc::FrameType::E3;
        mc::CodeType code = mc::CodeType::Binary;
        uint16_t serial = 0;
        mc::Route route;
        uint16_t cmd = 0, sub = 0;
        std::vector<Point> points;  // batch: one; random: words then dwords
        int count = 0;              // batch points
        int nWords = 0, nDwords = 0;
        std::vector<uint16_t> wdata;  // batch write words
        std::vector<uint8_t> bdata;   // batch write bits
    };

    static int hexv(uint8_t c) {
        if (c >= '0' && c <= '9') return c - '0';
        if (c >= 'A' && c <= 'F') return c - 'A' + 10;
        return -1;
    }
    static bool hexAt(const McBytes& b, size_t at, int n, uint32_t& v) {
        v = 0;
        if (at + static_cast<size_t>(n) > b.size()) return false;
        for (int i = 0; i < n; ++i) {
            const int d = hexv(b[at + static_cast<size_t>(i)]);
            if (d < 0) return false;
            v = (v << 4) | static_cast<uint32_t>(d);
        }
        return true;
    }

    // ASCII device: 2-char code, 6 digits in the radix of the contract (§1).
    bool asciiPoint(const McBytes& b, size_t at, Point& pt) {
        if (at + 8 > b.size()) return false;
        std::string name(b.begin() + static_cast<long>(at), b.begin() + static_cast<long>(at) + 2);
        if (name.size() == 2 && name[1] == '*') name.resize(1);
        const mc::McDeviceInfo* info = mc::deviceByName(name);
        if (!info) return false;
        int radix = info->asciiRadix;
        if (xyOctal && (info->device == mc::Device::X || info->device == mc::Device::Y)) radix = 8;
        uint32_t v = 0;
        for (size_t i = 0; i < 6; ++i) {
            const int d = hexv(b[at + 2 + i]);
            if (d < 0 || d >= radix) return false;
            v = v * static_cast<uint32_t>(radix) + static_cast<uint32_t>(d);
        }
        pt.dev = static_cast<int>(info->device);
        pt.number = v;
        return true;
    }

   public:
    bool xyOctal = false;  // ASCII X/Y numbers in octal

   private:
    bool parse(const McBytes& b, Parsed& p) {
        if (b.size() >= 2 && (b[0] == 0x50 || b[0] == 0x54) && b[1] == 0x00) {
            p.code = mc::CodeType::Binary;
            size_t at = 2;
            if (b[0] == 0x54) {
                if (b.size() < 6) return false;
                p.frame = mc::FrameType::E4;
                p.serial = static_cast<uint16_t>(b[2] | (b[3] << 8));
                at = 6;
            }
            if (b.size() < at + 13) return false;
            p.route.network = b[at];
            p.route.station = b[at + 1];
            p.route.moduleIo = static_cast<uint16_t>(b[at + 2] | (b[at + 3] << 8));
            p.route.moduleStation = b[at + 4];
            const size_t len = static_cast<size_t>(b[at + 5] | (b[at + 6] << 8));
            if (b.size() != at + 7 + len) return false;
            p.cmd = static_cast<uint16_t>(b[at + 9] | (b[at + 10] << 8));
            p.sub = static_cast<uint16_t>(b[at + 11] | (b[at + 12] << 8));
            size_t d = at + 13;
            auto point = [&](Point& pt) {
                if (d + 4 > b.size()) return false;
                pt.number = static_cast<uint32_t>(b[d] | (b[d + 1] << 8) | (b[d + 2] << 16));
                const mc::McDeviceInfo* info = mc::deviceByCode(b[d + 3]);
                pt.dev = info ? static_cast<int>(info->device) : -1;
                d += 4;
                return true;
            };
            if (p.cmd == 0x0403) {
                if (d + 2 > b.size()) return false;
                p.nWords = b[d];
                p.nDwords = b[d + 1];
                d += 2;
                for (int i = 0; i < p.nWords + p.nDwords; ++i) {
                    Point pt;
                    if (!point(pt)) return false;
                    p.points.push_back(pt);
                }
                return true;
            }
            Point pt;
            if (!point(pt) || d + 2 > b.size()) return false;
            p.points.push_back(pt);
            p.count = b[d] | (b[d + 1] << 8);
            d += 2;
            if (p.cmd == 0x1401 && p.sub == 0) {
                for (int i = 0; i < p.count; ++i, d += 2) {
                    if (d + 2 > b.size()) return false;
                    p.wdata.push_back(static_cast<uint16_t>(b[d] | (b[d + 1] << 8)));
                }
            } else if (p.cmd == 0x1401) {
                for (int i = 0; i < p.count; ++i) {
                    if (d + static_cast<size_t>(i / 2) >= b.size()) return false;
                    const uint8_t v = b[d + static_cast<size_t>(i / 2)];
                    p.bdata.push_back(((i % 2 == 0) ? (v >> 4) : (v & 0xF)) ? 1 : 0);
                }
            }
            return true;
        }
        // ASCII
        p.code = mc::CodeType::Ascii;
        size_t at = 4;
        uint32_t v;
        if (!hexAt(b, 0, 4, v)) return false;
        if (v == 0x5400) {
            p.frame = mc::FrameType::E4;
            if (!hexAt(b, 4, 4, v)) return false;
            p.serial = static_cast<uint16_t>(v);
            at = 12;
        } else if (v != 0x5000) {
            return false;
        }
        uint32_t net, pc, io, st, len, timer, cmd, sub;
        if (!hexAt(b, at, 2, net) || !hexAt(b, at + 2, 2, pc) || !hexAt(b, at + 4, 4, io) ||
            !hexAt(b, at + 8, 2, st) || !hexAt(b, at + 10, 4, len) ||
            !hexAt(b, at + 14, 4, timer) || !hexAt(b, at + 18, 4, cmd) ||
            !hexAt(b, at + 22, 4, sub))
            return false;
        if (b.size() != at + 14 + len) return false;
        p.route = {static_cast<uint8_t>(net), static_cast<uint8_t>(pc), static_cast<uint16_t>(io),
                   static_cast<uint8_t>(st)};
        p.cmd = static_cast<uint16_t>(cmd);
        p.sub = static_cast<uint16_t>(sub);
        size_t d = at + 26;
        if (p.cmd == 0x0403) {
            uint32_t n, m;
            if (!hexAt(b, d, 2, n) || !hexAt(b, d + 2, 2, m)) return false;
            p.nWords = static_cast<int>(n);
            p.nDwords = static_cast<int>(m);
            d += 4;
            for (uint32_t i = 0; i < n + m; ++i, d += 8) {
                Point pt;
                if (!asciiPoint(b, d, pt)) return false;
                p.points.push_back(pt);
            }
            return true;
        }
        Point pt;
        uint32_t count;
        if (!asciiPoint(b, d, pt) || !hexAt(b, d + 8, 4, count)) return false;
        p.points.push_back(pt);
        p.count = static_cast<int>(count);
        d += 12;
        if (p.cmd == 0x1401 && p.sub == 0) {
            for (uint32_t i = 0; i < count; ++i, d += 4) {
                uint32_t w;
                if (!hexAt(b, d, 4, w)) return false;
                p.wdata.push_back(static_cast<uint16_t>(w));
            }
        } else if (p.cmd == 0x1401) {
            for (uint32_t i = 0; i < count; ++i)
                p.bdata.push_back(d + i < b.size() && b[d + i] == '1' ? 1 : 0);
        }
        return true;
    }

    bool matches(const McFault& f, const Parsed& p) const {
        if (f.station >= 0 && f.station != p.route.station) return false;
        if (f.cmd >= 0 && f.cmd != p.cmd) return false;
        if (f.device < 0 && f.from < 0) return true;
        for (size_t i = 0; i < p.points.size(); ++i) {
            const Point& pt = p.points[i];
            if (f.device >= 0 && f.device != pt.dev) continue;
            const int64_t span =
                p.cmd == 0x0403 ? (static_cast<int>(i) < p.nWords ? 1 : 2) : std::max(1, p.count);
            const int64_t a = pt.number, z = a + span;  // touching [a, z)
            if (f.from >= 0 && (z <= f.from || a > f.to)) continue;
            return true;
        }
        return false;
    }
    bool consume(std::vector<McFault>::iterator& it) {
        if (--it->count <= 0) {
            it = faults.erase(it);
            return true;
        }
        ++it;
        return true;
    }

    uint16_t wordLocked(int station, int dev, uint32_t n) {
        auto m = words.find({station, dev});
        if (m == words.end()) return 0;
        auto it = m->second.find(n);
        return it == m->second.end() ? 0 : it->second;
    }

    // Runs the command; the end code, and the data in binary layout.
    uint16_t execute(const Parsed& p, McBytes& data) {
        const int st = p.route.station;
        auto devOk = [&](const Point& pt, int64_t span, bool bitUnits) -> uint16_t {
            if (pt.dev < 0) return 0xC05C;
            auto bd = badDevice.find(pt.dev);
            if (bd != badDevice.end()) return bd->second;
            const bool bitDev = mc::deviceInfo(static_cast<mc::Device>(pt.dev)).bit;
            if (bitUnits && !bitDev) return 0xC05B;
            const int64_t points = (bitDev && !bitUnits) ? span * 16 : span;
            if (static_cast<int64_t>(pt.number) + points > deviceSize) return 0xC056;
            return 0;
        };
        auto readWord = [&](const Point& pt, uint32_t k) -> uint16_t {
            const bool bitDev = mc::deviceInfo(static_cast<mc::Device>(pt.dev)).bit;
            if (!bitDev) return wordLocked(st, pt.dev, pt.number + k);
            // a bit device read by word from point pt.number + 16k
            uint16_t w = 0;
            for (uint32_t b = 0; b < 16; ++b) {
                const uint32_t q = pt.number + 16 * k + b;
                if ((wordLocked(st, pt.dev, q / 16) >> (q % 16)) & 1)
                    w |= static_cast<uint16_t>(1u << b);
            }
            return w;
        };
        auto le = [&](uint16_t w) {
            data.push_back(static_cast<uint8_t>(w & 0xFF));
            data.push_back(static_cast<uint8_t>(w >> 8));
        };
        if (p.cmd == 0x0401 && (p.sub == 0 || p.sub == 1)) {
            const bool bits = p.sub == 1;
            if (p.count < 1 || p.count > (bits ? mc::kMaxBatchBits : mc::kMaxBatchWords))
                return 0xC051;
            if (const uint16_t e = devOk(p.points[0], p.count, bits)) return e;
            const Point& pt = p.points[0];
            if (!bits) {
                for (int k = 0; k < p.count; ++k) le(readWord(pt, static_cast<uint32_t>(k)));
            } else {
                for (int k = 0; k < p.count; k += 2) {
                    auto bitAt = [&](int i) {
                        const uint32_t q = pt.number + static_cast<uint32_t>(i);
                        return (wordLocked(st, pt.dev, q / 16) >> (q % 16)) & 1;
                    };
                    uint8_t v = static_cast<uint8_t>(bitAt(k) << 4);
                    if (k + 1 < p.count) v = static_cast<uint8_t>(v | bitAt(k + 1));
                    data.push_back(v);
                }
            }
            return 0;
        }
        if (p.cmd == 0x1401 && (p.sub == 0 || p.sub == 1)) {
            const bool bits = p.sub == 1;
            if (p.count < 1 || p.count > (bits ? mc::kMaxBatchBits : mc::kMaxBatchWords))
                return 0xC051;
            if (const uint16_t e = devOk(p.points[0], p.count, bits)) return e;
            const Point& pt = p.points[0];
            if (!bits) {
                for (size_t k = 0; k < p.wdata.size(); ++k)
                    words[{st, pt.dev}][pt.number + static_cast<uint32_t>(k)] = p.wdata[k];
            } else {
                for (size_t k = 0; k < p.bdata.size(); ++k) {
                    const uint32_t q = pt.number + static_cast<uint32_t>(k);
                    uint16_t& w = words[{st, pt.dev}][q / 16];
                    w = static_cast<uint16_t>(p.bdata[k] ? (w | (1u << (q % 16)))
                                                         : (w & ~(1u << (q % 16))));
                }
            }
            return 0;
        }
        if (p.cmd == 0x0403 && p.sub == 0) {
            if (p.nWords + p.nDwords < 1 || p.nWords + p.nDwords > mc::kMaxRandomPoints)
                return 0xC051;
            for (int i = 0; i < p.nWords + p.nDwords; ++i)
                if (const uint16_t e =
                        devOk(p.points[static_cast<size_t>(i)], i < p.nWords ? 1 : 2, false))
                    return e;
            for (int i = 0; i < p.nWords; ++i) le(readWord(p.points[static_cast<size_t>(i)], 0));
            for (int i = p.nWords; i < p.nWords + p.nDwords; ++i) {
                le(readWord(p.points[static_cast<size_t>(i)], 0));
                le(readWord(p.points[static_cast<size_t>(i)], 1));
            }
            return 0;
        }
        return 0xC059;
    }

    McBytes encode(const Parsed& p, uint16_t endCode, const McBytes& binData) {
        McBytes out;
        const bool err = endCode != 0;
        if (p.code == mc::CodeType::Binary) {
            if (p.frame == mc::FrameType::E3) {
                out = {0xD0, 0x00};
            } else {
                out = {0xD4,
                       0x00,
                       static_cast<uint8_t>(p.serial & 0xFF),
                       static_cast<uint8_t>(p.serial >> 8),
                       0,
                       0};
            }
            out.push_back(p.route.network);
            out.push_back(p.route.station);
            out.push_back(static_cast<uint8_t>(p.route.moduleIo & 0xFF));
            out.push_back(static_cast<uint8_t>(p.route.moduleIo >> 8));
            out.push_back(p.route.moduleStation);
            McBytes body = {static_cast<uint8_t>(endCode & 0xFF),
                            static_cast<uint8_t>(endCode >> 8)};
            if (err) {
                body.insert(body.end(),
                            {p.route.network, p.route.station,
                             static_cast<uint8_t>(p.route.moduleIo & 0xFF),
                             static_cast<uint8_t>(p.route.moduleIo >> 8), p.route.moduleStation,
                             static_cast<uint8_t>(p.cmd & 0xFF), static_cast<uint8_t>(p.cmd >> 8),
                             static_cast<uint8_t>(p.sub & 0xFF), static_cast<uint8_t>(p.sub >> 8)});
            } else {
                body.insert(body.end(), binData.begin(), binData.end());
            }
            out.push_back(static_cast<uint8_t>(body.size() & 0xFF));
            out.push_back(static_cast<uint8_t>(body.size() >> 8));
            out.insert(out.end(), body.begin(), body.end());
            return out;
        }
        std::string s = p.frame == mc::FrameType::E3 ? "D000" : "D400" + hex(p.serial, 4) + "0000";
        s += hex(p.route.network, 2) + hex(p.route.station, 2) + hex(p.route.moduleIo, 4) +
             hex(p.route.moduleStation, 2);
        std::string body = hex(endCode, 4);
        if (err) {
            body += hex(p.route.network, 2) + hex(p.route.station, 2) + hex(p.route.moduleIo, 4) +
                    hex(p.route.moduleStation, 2) + hex(p.cmd, 4) + hex(p.sub, 4);
        } else if (p.cmd == 0x0401 && p.sub == 1) {
            for (int i = 0; i < p.count; ++i) {
                const uint8_t v = binData[static_cast<size_t>(i / 2)];
                body.push_back((((i % 2 == 0) ? (v >> 4) : (v & 0xF)) != 0) ? '1' : '0');
            }
        } else if (p.cmd == 0x0403) {
            for (int i = 0; i < p.nWords; ++i)
                body += hex(static_cast<uint32_t>(binData[2 * i] | (binData[2 * i + 1] << 8)), 4);
            for (int i = 0; i < p.nDwords; ++i) {
                const size_t o = static_cast<size_t>(2 * p.nWords + 4 * i);
                body += hex(static_cast<uint32_t>(binData[o] | (binData[o + 1] << 8) |
                                                  (binData[o + 2] << 16) |
                                                  (static_cast<uint32_t>(binData[o + 3]) << 24)),
                            8);
            }
        } else {
            for (size_t i = 0; i + 1 < binData.size(); i += 2)
                body += hex(static_cast<uint32_t>(binData[i] | (binData[i + 1] << 8)), 4);
        }
        s += hex(static_cast<uint32_t>(body.size()), 4) + body;
        return McBytes(s.begin(), s.end());
    }
    static std::string hex(uint32_t v, int n) {
        static const char k[] = "0123456789ABCDEF";
        std::string s(static_cast<size_t>(n), '0');
        for (int i = n - 1; i >= 0; --i, v >>= 4) s[static_cast<size_t>(i)] = k[v & 0xF];
        return s;
    }

    std::map<std::pair<int, int>, std::map<uint32_t, uint16_t>> words;
    std::vector<McFault> faults;
    std::vector<McPlcRequest> log;
};

// The transport: replies arrive after `latencyMs`; TCP as a byte stream, UDP one datagram a read.
class McFakeTransport : public drv::Transport {
   public:
    McFakeTransport(FakeMcPlc& plc, FakeClock& clock, bool udp = false)
        : plc_(plc), clock_(clock), udp_(udp) {}

    drv::ConnectCode connect(const std::string&, int, int timeoutMs) override {
        ++plc_.connectAttempts;
        close();
        (void)timeoutMs;
        if (plc_.refuse && !udp_) {
            clock_.advance(1);
            return drv::ConnectCode::Refused;
        }
        open_ = true;
        epoch_ = plc_.dropEpoch;
        ++plc_.connections;
        clock_.advance(1);
        return drv::ConnectCode::Ok;
    }
    bool isOpen() const override { return open_; }
    void close() override {
        open_ = false;
        events_.clear();
        inbound_.clear();
    }
    bool peerClosed() override { return open_ && !udp_ && epoch_ != plc_.dropEpoch; }
    size_t discardInput() override {
        size_t n = 0;
        for (const auto& d : inbound_) n += d.size();
        inbound_.clear();
        // datagrams already due are dropped too
        while (!events_.empty() && events_.front().at <= clock_.monoMs()) events_.pop_front();
        return n;
    }
    bool writeAll(const uint8_t* d, size_t n, int) override {
        if (!open_ || peerClosed()) return false;
        plc_.bytesIn += n;
        const int64_t now = clock_.monoMs();
        McReply r = plc_.handle(McBytes(d, d + n), now);
        if (onWrite) onWrite(McBytes(d, d + n));
        if (mutateReply) mutateReply(r);
        if (r.close) {
            if (!udp_) events_.push_back({now + latencyMs + r.delayMs, {}, true});
            return true;
        }
        int64_t at = now + latencyMs + r.delayMs;
        for (auto& piece : r.pieces) {
            events_.push_back({at, piece, false});
            at += 1;
        }
        std::stable_sort(events_.begin(), events_.end(),
                         [](const Event& a, const Event& b) { return a.at < b.at; });
        return true;
    }
    drv::ReadResult read(uint8_t* buf, size_t max, int timeoutMs) override {
        if (interrupted_) return {drv::ReadCode::Interrupted, 0};
        const int64_t deadline = clock_.monoMs() + timeoutMs;
        for (;;) {
            if (!inbound_.empty()) {
                McBytes& front = inbound_.front();
                const size_t n = std::min(max, front.size());
                std::copy(front.begin(), front.begin() + static_cast<long>(n), buf);
                plc_.bytesOut += n;
                if (udp_ || n == front.size())
                    inbound_.pop_front();
                else
                    front.erase(front.begin(), front.begin() + static_cast<long>(n));
                return {drv::ReadCode::Data, n};
            }
            if (!open_) return {drv::ReadCode::Closed, 0};
            if (events_.empty() || events_.front().at > deadline) {
                clock_.set(deadline);
                return {drv::ReadCode::Timeout, 0};
            }
            const Event e = events_.front();
            events_.pop_front();
            clock_.set(e.at);
            if (e.close) {
                open_ = false;
                return {drv::ReadCode::Closed, 0};
            }
            inbound_.push_back(e.bytes);
        }
    }
    void interrupt() override { interrupted_ = true; }
    void clearInterrupt() override { interrupted_ = false; }
    uint64_t bytesSent() const override { return plc_.bytesIn; }
    uint64_t bytesReceived() const override { return plc_.bytesOut; }

    int64_t latencyMs = 5;
    std::function<void(const McBytes&)> onWrite;
    std::function<void(McReply&)> mutateReply;

   private:
    struct Event {
        int64_t at;
        McBytes bytes;
        bool close;
    };
    FakeMcPlc& plc_;
    FakeClock& clock_;
    bool udp_;
    bool open_ = false;
    int epoch_ = 0;
    std::deque<Event> events_;
    std::deque<McBytes> inbound_;
    std::atomic<bool> interrupted_{false};
};

}  // namespace mat::testing
