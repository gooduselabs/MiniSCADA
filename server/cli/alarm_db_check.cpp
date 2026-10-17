#include "server/cli/alarm_db_check.hpp"

#include <sqlite3.h>
#include <sys/stat.h>

#include <cstring>
#include <map>
#include <ostream>
#include <set>
#include <string>
#include <vector>

#include "nlohmann/json.hpp"

namespace mat {

namespace {

using nlohmann::json;

bool hasFlag(int argc, char** argv, const char* flag) {
    for (int i = 1; i < argc; ++i)
        if (std::strcmp(argv[i], flag) == 0) return true;
    return false;
}

bool fileExists(const std::string& p) {
    struct stat st {};
    return ::stat(p.c_str(), &st) == 0;
}

struct Db {
    sqlite3* db = nullptr;
    ~Db() {
        if (db) sqlite3_close(db);
    }
    bool open(const std::string& path) {
        // READONLY and no CREATE: a missing or damaged file is reported, never made or replaced.
        if (sqlite3_open_v2(path.c_str(), &db, SQLITE_OPEN_READONLY, nullptr) != SQLITE_OK)
            return false;
        sqlite3_busy_timeout(db, 2000);
        return true;
    }
    // First column of every row, joined with newlines; false on an SQL error.
    bool texts(const char* sql, std::vector<std::string>& out) {
        sqlite3_stmt* st = nullptr;
        if (sqlite3_prepare_v2(db, sql, -1, &st, nullptr) != SQLITE_OK) return false;
        int rc;
        while ((rc = sqlite3_step(st)) == SQLITE_ROW) {
            const unsigned char* t = sqlite3_column_text(st, 0);
            out.push_back(t ? reinterpret_cast<const char*>(t) : "");
        }
        sqlite3_finalize(st);
        return rc == SQLITE_DONE;
    }
    int64_t number(const char* sql, int64_t dflt = -1) {
        sqlite3_stmt* st = nullptr;
        if (sqlite3_prepare_v2(db, sql, -1, &st, nullptr) != SQLITE_OK) return dflt;
        int64_t v = dflt;
        if (sqlite3_step(st) == SQLITE_ROW) v = sqlite3_column_int64(st, 0);
        sqlite3_finalize(st);
        return v;
    }
};

// What audit.db says of acknowledgements: occurrence ids named by a single-record alarm.ack, and
// instance ids named by any alarm.ack (a batch names at most ten).
struct AuditAcks {
    bool available = false;
    std::set<std::pair<std::string, int64_t>> occurrences;  // (instance, occurrence)
    std::set<std::string> instances;
};

AuditAcks readAuditAcks(const std::string& path) {
    AuditAcks a;
    if (!fileExists(path)) return a;
    Db db;
    if (!db.open(path)) return a;
    sqlite3_stmt* st = nullptr;
    if (sqlite3_prepare_v2(db.db,
                           "SELECT target, detail FROM audit WHERE action = 'alarm.ack' AND "
                           "result = 'ok'",
                           -1, &st, nullptr) != SQLITE_OK)
        return a;
    a.available = true;
    while (sqlite3_step(st) == SQLITE_ROW) {
        const unsigned char* t = sqlite3_column_text(st, 0);
        const unsigned char* d = sqlite3_column_text(st, 1);
        const std::string target = t ? reinterpret_cast<const char*>(t) : "";
        const json detail =
            json::parse(d ? reinterpret_cast<const char*>(d) : "{}", nullptr, false);
        if (!detail.is_object()) continue;
        if (detail.contains("occurrence") && detail["occurrence"].is_number_integer())
            a.occurrences.insert({target, detail["occurrence"].get<int64_t>()});
        if (detail.contains("ids") && detail["ids"].is_array())
            for (const json& id : detail["ids"])
                if (id.is_string()) a.instances.insert(id.get<std::string>());
    }
    sqlite3_finalize(st);
    return a;
}

}  // namespace

bool isAlarmDbCheckCommand(int argc, char** argv) {
    return hasFlag(argc, argv, "--alarm-db-check");
}

int runAlarmDbCheckCli(int argc, char** argv, const DeviceCliEnv& env, std::ostream& out,
                       std::ostream& err) {
    std::vector<std::string> overrides;  // --config, --data-dir
    for (int i = 1; i < argc; ++i) {
        const std::string a = argv[i];
        if (a == "--alarm-db-check") continue;
        if (a == "--config" || a == "--data-dir") {
            if (i + 1 >= argc || *argv[i + 1] == '\0') {
                err << a << " cần một giá trị\n";
                return 2;
            }
            overrides.push_back(a);
            overrides.push_back(argv[++i]);
        } else {
            err << "tham số không hỗ trợ: " << a << "\n";
            return 2;
        }
    }
    RuntimeConfig cfg;
    std::string error;
    if (!loadDeviceCliConfig(overrides, env, cfg, error)) {
        err << "cấu hình: " << error << "\n";
        return 2;
    }
    const std::string dir = cfg.dataDir.back() == '/' ? cfg.dataDir : cfg.dataDir + "/";
    const std::string path = dir + "alarm.db";
    json j = {{"path", path}};
    if (!fileExists(path)) {
        j["state"] = "missing";
        out << j.dump(2) << "\n";
        return 0;
    }
    Db db;
    std::vector<std::string> lines;
    if (!db.open(path) || !db.texts("PRAGMA integrity_check(10)", lines)) {
        j["state"] = "damaged";
        j["integrity"] = "không mở được file (không phải CSDL SQLite hoặc đã hỏng)";
        out << j.dump(2) << "\n";
        return 1;
    }
    std::string integrity;
    for (const auto& l : lines) integrity += (integrity.empty() ? "" : "\n") + l;
    if (integrity != "ok") {
        j["state"] = "damaged";
        j["integrity"] = integrity;
        out << j.dump(2) << "\n";
        return 1;
    }
    j["state"] = "ok";
    j["integrity"] = "ok";
    j["rows"] = db.number("SELECT COUNT(*) FROM alarm_occurrence", 0);
    j["open"] = db.number("SELECT COUNT(*) FROM alarm_occurrence WHERE closed = 0", 0);
    j["acked"] = db.number("SELECT COUNT(*) FROM alarm_occurrence WHERE ts_ack_ms IS NOT NULL", 0);
    std::vector<std::string> schema;
    db.texts("SELECT value FROM alarm_meta WHERE key = 'schema'", schema);
    // NOLINTNEXTLINE(cert-err34-c): written by the runtime (alarm_meta), CLI report (SAST T055)
    j["schema"] = schema.empty() ? 0 : std::atoi(schema[0].c_str());

    // Every acknowledgement is in audit.db (SC-008): the audit record is written first.
    const AuditAcks audit = readAuditAcks(dir + "audit.db");
    json missing = json::array();
    sqlite3_stmt* st = nullptr;
    if (sqlite3_prepare_v2(db.db,
                           "SELECT id, alarm_id FROM alarm_occurrence WHERE ts_ack_ms IS NOT NULL "
                           "ORDER BY id",
                           -1, &st, nullptr) == SQLITE_OK) {
        while (sqlite3_step(st) == SQLITE_ROW) {
            const int64_t id = sqlite3_column_int64(st, 0);
            const std::string alarm = reinterpret_cast<const char*>(sqlite3_column_text(st, 1));
            const bool known = audit.available && (audit.occurrences.count({alarm, id}) > 0 ||
                                                   audit.instances.count(alarm) > 0);
            if (!known) missing.push_back({{"id", id}, {"alarmId", alarm}});
        }
        sqlite3_finalize(st);
    }
    j["ackWithoutAudit"] = missing;
    out << j.dump(2) << "\n";
    return missing.empty() ? 0 : 3;
}

}  // namespace mat
