// T063 / FR-025: project activation at startup (server/startup.hpp, taken out of main.cpp) and the
// HTTP API built from it, in-process. An invalid project is not activated, yet the runtime keeps
// serving: system/info shows the errors and /api/v1/projects/active answers 503.
#include "server/startup.hpp"

#include <dirent.h>
#include <gtest/gtest.h>

#include <fstream>
#include <set>
#include <sstream>

#include "core/package/project_digest.hpp"
#include "server/http/http_api.hpp"
#include "server/tests/civet_test_support.hpp"

using namespace mat;
using nlohmann::json;

namespace {
const std::string kVectors = std::string(MAT_SOURCE_DIR) + "/tests/project-vectors";
const std::string kSchemas = std::string(MAT_SOURCE_DIR) + "/schemas";

ActiveProject activate(const std::string& vector, size_t configMax, TagStore& store) {
    return activateProject(validateProject(kVectors + "/" + vector, kSchemas), configMax, store);
}

json expectedOf(const std::string& vector) {
    std::ifstream in(kVectors + "/" + vector + "/expected.json", std::ios::binary);
    std::stringstream s;
    s << in.rdbuf();
    return json::parse(s.str(), nullptr, false);
}

// Valid project vectors with a digest in expected.json (T015).
std::vector<std::string> digestVectors() {
    std::vector<std::string> out;
    if (DIR* d = opendir(kVectors.c_str())) {
        while (const dirent* e = readdir(d)) {
            const std::string n = e->d_name;
            if (n == "." || n == "..") continue;
            const json x = expectedOf(n);
            if (x.is_object() && x.value("valid", false) && x.contains("digest")) out.push_back(n);
        }
        closedir(d);
    }
    return out;
}
}  // namespace

// Feature 005 (contracts/matscada-package.md §4, live-protocol-1.1.md §1): the digest of the files
// of a project on disk is the digest of the vectors, the value the Studio computes.
TEST(StartupDigest, ProjectDirDigestMatchesEveryValidVector) {
    const std::vector<std::string> vectors = digestVectors();
    ASSERT_GE(vectors.size(), 10u);
    for (const auto& name : vectors) {
        // a v05-* case carries the runtime it is checked with (0.8.0, feature 009)
        const ProjectValidation v =
            validateProject(kVectors + "/" + name, kSchemas,
                            expectedOf(name).value("runtimeVersion", std::string(kRuntimeVersion)));
        ASSERT_TRUE(v.valid) << name;
        std::string error;
        const auto digest = projectDirDigest(kVectors + "/" + name, v.project->files(), &error);
        ASSERT_TRUE(digest.has_value()) << name << ": " << error;
        EXPECT_EQ(*digest, expectedOf(name)["digest"].get<std::string>()) << name;
    }
}

TEST(StartupDigest, UnreadableFileGivesNoDigest) {
    std::string error;
    EXPECT_FALSE(projectDirDigest("/nonexistent", {"project.json"}, &error).has_value());
    EXPECT_NE(error.find("project.json"), std::string::npos) << error;
    // A directory where a file should be is not a file of the project.
    EXPECT_FALSE(projectDirDigest(kVectors, {"valid-minimal"}, &error).has_value());
}

// The digest of the running project goes to the live hello (1.1.0), GET /api/v1/projects/active
// (top-level key) and system/info (project.digest); the keys of 0.3.0 stay.
TEST(StartupDigest, DigestGoesToHelloActiveAndInfo) {
    TagStore store;
    const ProjectValidation v = validateProject(kVectors + "/valid-minimal", kSchemas);
    const auto digest = projectDirDigest(kVectors + "/valid-minimal", v.project->files());
    ASSERT_TRUE(digest.has_value());
    const ActiveProject a = activateProject(v, 10, store, digest);
    ASSERT_TRUE(a.active);
    EXPECT_EQ(a.digest, digest);
    const json hello = json::parse(a.helloJson);
    EXPECT_EQ(hello["projectId"], "vector");
    EXPECT_EQ(hello["projectVersion"], "0.1.0");
    EXPECT_EQ(hello["digest"], *digest);
    const json active = json::parse(a.activeJson);
    EXPECT_EQ(active["digest"], *digest);
    EXPECT_EQ(active["project"]["projectId"], "vector");
    EXPECT_TRUE(active["tags"].is_object() || active["tags"].is_array());
    EXPECT_TRUE(active["screens"].is_object());
    EXPECT_EQ(a.info["digest"], *digest);
    EXPECT_EQ(a.info["status"], "active");
}

// No project runs: digest null in system/info, hello project null, no projects/active body.
TEST(StartupDigest, NoRunningProjectMeansNullDigest) {
    TagStore store;
    const ActiveProject invalid =
        activateProject(validateProject(kVectors + "/invalid-ref-tag", kSchemas), 10, store,
                        std::string("sha256:" + std::string(64, 'a')));
    EXPECT_FALSE(invalid.digest.has_value());
    ASSERT_TRUE(invalid.info.contains("digest"));
    EXPECT_TRUE(invalid.info["digest"].is_null());
    EXPECT_EQ(invalid.helloJson, "null");
    const ActiveProject missing =
        activateProject(validateProject("/nonexistent/project", kSchemas), 10, store);
    ASSERT_TRUE(missing.info.contains("digest"));
    EXPECT_TRUE(missing.info["digest"].is_null());
    // A valid project whose digest could not be read still runs, with digest null: the key is
    // there (protocol 1.1.0), so a client does not take the server for a 1.0.0 one.
    const ActiveProject noDigest = activate("valid-minimal", 10, store);
    EXPECT_TRUE(noDigest.active);
    EXPECT_TRUE(noDigest.info["digest"].is_null());
    const json active = json::parse(noDigest.activeJson);
    ASSERT_TRUE(active.contains("digest"));
    EXPECT_TRUE(active["digest"].is_null());
    const json hello = json::parse(noDigest.helloJson);
    ASSERT_TRUE(hello.contains("digest"));
    EXPECT_TRUE(hello["digest"].is_null());
}

// Constitution IV: the project may only lower the runtime limit, never pass the hard limit.
TEST(Startup, EffectiveMaxClientsIsTheSmallerLimit) {
    EXPECT_EQ(effectiveMaxClients(10, 8), 8u);
    EXPECT_EQ(effectiveMaxClients(5, 10), 5u);
    EXPECT_EQ(effectiveMaxClients(10, 10), 10u);
    EXPECT_EQ(effectiveMaxClients(10, 50), 10u);
    EXPECT_EQ(effectiveMaxClients(0, 0), 1u);
}

TEST(Startup, InvalidProjectIsNotActivatedButReported) {
    TagStore store;
    const ActiveProject a = activate("invalid-ref-tag", 10, store);
    EXPECT_FALSE(a.active);
    EXPECT_EQ(a.info["status"], "invalid");
    ASSERT_EQ(a.info["errors"].size(), 1u);
    EXPECT_EQ(a.info["errors"][0]["code"], "E_REF_TAG");
    EXPECT_EQ(a.errors, a.info["errors"]);
    EXPECT_TRUE(a.activeJson.empty());
    EXPECT_TRUE(a.allowlist.empty());
    EXPECT_EQ(a.helloJson, "null");
    EXPECT_EQ(a.maxClients, 10u);
    EXPECT_EQ(store.size(), 0u);  // no tag of an invalid project is served
}

TEST(Startup, MissingProjectIsReportedAsMissing) {
    TagStore store;
    const ActiveProject a =
        activateProject(validateProject("/nonexistent/project", kSchemas), 10, store);
    EXPECT_FALSE(a.active);
    EXPECT_EQ(a.info["status"], "missing");
}

TEST(Startup, ValidProjectIsActivatedWithTheSmallerLimit) {
    TagStore store;
    const ActiveProject a = activate("valid-minimal", 4, store);
    ASSERT_TRUE(a.active);
    EXPECT_EQ(a.info["status"], "active");
    EXPECT_EQ(a.info["projectId"], "vector");
    EXPECT_EQ(a.info["projectVersion"], "0.1.0");
    EXPECT_TRUE(a.info["errors"].empty());
    EXPECT_EQ(a.maxClients, 4u);  // config 4 < project 10
    EXPECT_EQ(store.size(), 3u);
    EXPECT_TRUE(store.indexOf("T.LEVEL").has_value());
    EXPECT_EQ(a.allowlist, std::set<std::string>{"screens/main.svg"});
    EXPECT_EQ(json::parse(a.activeJson)["project"]["projectId"], "vector");
    EXPECT_EQ(json::parse(a.helloJson)["projectId"], "vector");
}

// `"maxClients": 1e1` is an integer (contracts/project-format.md): it limits the sessions to 10.
TEST(Startup, IntegralFloatMaxClientsCounts) {
    TagStore store;
    const ActiveProject a = activate("valid-integral-float", 10, store);
    ASSERT_TRUE(a.active);
    EXPECT_EQ(a.maxClients, 10u);
}

TEST(Startup, InvalidProjectKeepsServingInfoAndActiveIs503) {
    TagStore store;
    const ActiveProject a = activate("invalid-ref-tag", 10, store);
    HttpApi::Options o;
    o.docroot = "/nonexistent";
    o.projectDir = kVectors + "/invalid-ref-tag";
    o.projectAllowlist = a.allowlist;
    o.activeProjectJson = a.activeJson;
    o.projectErrors = a.errors;
    HttpApi api(o, [&] { return json{{"project", a.info}, {"tagCount", store.size()}}; });
    test::TestServer server;
    ASSERT_NE(server.ctx, nullptr);
    api.install(server.ctx);

    const auto active = test::httpGet(server.port, "/api/v1/projects/active");
    EXPECT_EQ(active.status, 503);
    const json body = json::parse(active.body);
    EXPECT_EQ(body["error"], "NO_VALID_PROJECT");
    EXPECT_EQ(body["errors"][0]["code"], "E_REF_TAG");

    const auto info = test::httpGet(server.port, "/api/v1/system/info");
    EXPECT_EQ(info.status, 200);
    EXPECT_EQ(json::parse(info.body)["project"]["status"], "invalid");
    EXPECT_EQ(json::parse(info.body)["tagCount"], 0);
    // Nothing of the invalid project is served.
    EXPECT_EQ(test::httpGet(server.port, "/project/screens/main.svg").status, 404);
}

// ---- feature 006 T178 (contracts/project-format-0.2.md §8, §11; FR-054): what GET
// /api/v1/projects/active carries for a project 0.2: the value tables that bindings use, and the
// channels by id, name and kind.

#include <filesystem>

namespace {

namespace fs = std::filesystem;

// A copy of the 0.2 vector with three value tables: TrangThaiBom (used by a Tag that a binding
// reads, and by a binding by name), Xanh (named by a binding only), Mau (used by nothing).
std::string projectWithTables(const std::string& name) {
    const fs::path dir = fs::temp_directory_path() / ("mat-startup-" + name);
    fs::remove_all(dir);
    fs::copy(kVectors + "/v02-valid-full", dir, fs::copy_options::recursive);
    auto readJson = [](const fs::path& p) {
        std::ifstream in(p, std::ios::binary);
        return json::parse(in);
    };
    auto writeJson = [](const fs::path& p, const json& j) {
        std::ofstream(p, std::ios::binary | std::ios::trunc) << j.dump(2);
    };
    for (const char* t : {"Xanh", "Mau"}) {
        json table = readJson(dir / "value-tables/TrangThaiBom.json");
        table["name"] = t;
        writeJson(dir / ("value-tables/" + std::string(t) + ".json"), table);
    }
    json project = readJson(dir / "project.json");
    project["valueTables"] = json::array({"TrangThaiBom", "Xanh", "Mau"});
    writeJson(dir / "project.json", project);
    json bindings = readJson(dir / "screens/main.bindings.json");
    bindings["elements"][0]["bindings"].push_back(
        {{"id", "b-xanh"},
         {"target", "text.content"},
         {"source", {{"type", "tag"}, {"tagId", "TANK01.LEVEL"}}},
         {"transform", {{"kind", "valueTable"}, {"table", "Xanh"}, {"output", "text"}}}});
    writeJson(dir / "screens/main.bindings.json", bindings);
    return dir.string();
}

}  // namespace

TEST(StartupActive02, ValueTablesAreOnlyTheOnesBindingsUseDirectlyOrThroughTheTag) {
    const std::string dir = projectWithTables("tables");
    const ProjectValidation v = validateProject(dir, kSchemas);
    ASSERT_TRUE(v.valid) << resultJson(v);
    TagStore store;
    const ActiveProject a = activateProject(v, 10, store);
    ASSERT_TRUE(a.active);
    const json active = json::parse(a.activeJson);
    ASSERT_TRUE(active["valueTables"].is_object());
    std::set<std::string> names;
    for (auto it = active["valueTables"].begin(); it != active["valueTables"].end(); ++it)
        names.insert(it.key());
    // TrangThaiBom: the Tag PUMP01.STATE has it and two bindings read that Tag; Xanh: a binding
    // names it; Mau: nothing uses it, so the page does not download it
    EXPECT_EQ(names, (std::set<std::string>{"TrangThaiBom", "Xanh"}));
    EXPECT_EQ(active["valueTables"]["TrangThaiBom"]["entries"][1]["text"], "Chạy");
    EXPECT_EQ(active["valueTables"]["Xanh"]["name"], "Xanh");
    fs::remove_all(dir);
}

TEST(StartupActive02, TheChannelsAreIdsNamesAndKindsOnlyAndTheKeyIsThereOnce) {
    TagStore store;
    const ActiveProject a = activate("v02-valid-full", 10, store);
    ASSERT_TRUE(a.active);
    const json active = json::parse(a.activeJson);
    ASSERT_TRUE(active["connections"].is_object()) << a.activeJson.substr(0, 400);
    const json& channels = active["connections"]["channels"];
    ASSERT_GE(channels.size(), 2u);
    for (const json& ch : channels) {
        EXPECT_TRUE(ch.contains("id"));
        EXPECT_TRUE(ch.contains("name"));
        EXPECT_TRUE(ch["kind"] == "modbus-tcp" || ch["kind"] == "modbus-rtu");
        for (auto it = ch.begin(); it != ch.end(); ++it)
            EXPECT_TRUE(it.key() == "id" || it.key() == "name" || it.key() == "kind" ||
                        it.key() == "devices")
                << "key " << it.key()
                << ": an address, a port or a serial parameter must not leave";
        for (const json& d : ch["devices"]) {
            EXPECT_EQ(d.size(), 2u);
            EXPECT_TRUE(d.contains("id") && d.contains("name"));
        }
    }
    // no address, port or serial parameter anywhere in what the page may read
    const json& conns = active["connections"];
    const std::string text = conns.dump();
    for (const char* secret : {"192.168", "host", "ttyAS", "baud", "serial", "unitId", "slave"})
        EXPECT_EQ(text.find(secret), std::string::npos) << secret;
    // the key is written once: a second copy would be taken for the last one by a JSON parser
    size_t count = 0;
    for (size_t at = a.activeJson.find("\"connections\":"); at != std::string::npos;
         at = a.activeJson.find("\"connections\":", at + 1))
        ++count;
    EXPECT_EQ(count, 1u);
}

TEST(StartupActive02, ProjectWithoutBindingTablesOrConnectionsHasEmptyOnes) {
    TagStore store;
    const ActiveProject a = activate("v02-valid-no-connections", 10, store);
    ASSERT_TRUE(a.active);
    const json active = json::parse(a.activeJson);
    EXPECT_EQ(active["valueTables"], json::object());
    ASSERT_TRUE(active["connections"].is_object());
    EXPECT_EQ(active["connections"]["channels"], json::array());
}

TEST(StartupActive02, AProject01HasNeitherKey) {
    TagStore store;
    const ActiveProject a = activate("valid-minimal", 10, store);
    ASSERT_TRUE(a.active);
    const json active = json::parse(a.activeJson);
    EXPECT_FALSE(active.contains("valueTables"));
    EXPECT_FALSE(active.contains("connections"));
}

// ---- feature 007 (device-api-1.2 §4, T030): the summary of a 0.3 project ----

TEST(StartupActive03, TheBodyIsASummaryAndTheScreensAreFilesToLoadOneByOne) {
    TagStore store;
    const ActiveProject a = activate("v03-valid-full", 10, store);
    ASSERT_TRUE(a.active) << a.info.dump();
    const json active = json::parse(a.activeJson);
    for (const char* key :
         {"project", "tags", "valueTables", "connections", "navigation", "screens", "digest"})
        EXPECT_TRUE(active.contains(key)) << key;
    EXPECT_EQ(active["project"]["schemaVersion"], "0.3.0");
    EXPECT_FALSE(active.contains("items")) << "no items: a few KiB, not the screens";
    // the screens: id, name, kind and the file to load, in the order of project.json
    ASSERT_TRUE(active["screens"].is_array());
    ASSERT_EQ(active["screens"].size(), 2u);
    EXPECT_EQ(active["screens"][0]["id"], "main");
    EXPECT_EQ(active["screens"][0]["kind"], "screen");
    EXPECT_EQ(active["screens"][0]["file"], "screens/main.screen.json");
    EXPECT_TRUE(active["screens"][0].contains("name"));
    EXPECT_EQ(active["screens"][1]["id"], "pump");
    EXPECT_FALSE(active["screens"][0].contains("items"));
    // the Tags with what a widget needs
    ASSERT_TRUE(active["tags"]["tags"].is_array());
    EXPECT_FALSE(active["tags"]["tags"].empty());
    // channels: id, name, kind; never an address
    ASSERT_TRUE(active["connections"].is_array());
    for (const auto& ch : active["connections"]) {
        EXPECT_TRUE(ch.contains("id") && ch.contains("name") && ch.contains("kind"));
        EXPECT_FALSE(ch.contains("tcp")) << "no address on a public page";
        EXPECT_FALSE(ch.contains("devices"));
    }
    EXPECT_EQ(active["navigation"]["position"], "left");
    // the value tables of the Tags and the widgets
    EXPECT_TRUE(active["valueTables"].is_object());
    // the screen files and the SVG and binding files of the svg items are served, nothing else
    // (the page loads the bindings of an svg item with GET /project/<bindingFile>; found by web-it)
    EXPECT_TRUE(a.allowlist.count("screens/main.screen.json"));
    EXPECT_TRUE(a.allowlist.count("screens/pump.screen.json"));
    EXPECT_TRUE(a.allowlist.count("screens/main.svg"));
    EXPECT_TRUE(a.allowlist.count("screens/main.bindings.json"))
        << "the page fetches the bindings of an svg item";
    EXPECT_FALSE(a.allowlist.count("tags.json"));
    // the engine runs its Tags as for 0.2
    EXPECT_TRUE(a.model != nullptr);
}

TEST(StartupActive03, AProjectOf02KeepsItsShapeForTheOlderPage) {
    TagStore store;
    const ActiveProject a = activate("v02-valid-full", 10, store);
    ASSERT_TRUE(a.active);
    const json active = json::parse(a.activeJson);
    EXPECT_TRUE(active["screens"].is_object()) << "0.2: every screen in the body, as 0.5 sent it";
    EXPECT_TRUE(active["connections"].is_object());
}

// ---- feature 008 (T030, project-format-0.4 §1, §9): a 0.4 project runs, its SVG and binding files
// are served, nothing else; 0.3 and 0.1 projects still run; a schemaVersion that is not known is
// refused ----

TEST(StartupActive04, AProject04IsActivatedWithItsSummaryAndFiles) {
    TagStore store;
    const ActiveProject a = activate("v04-valid-full", 10, store);
    ASSERT_TRUE(a.active) << a.info.dump();
    EXPECT_EQ(a.info["status"], "active");
    const json active = json::parse(a.activeJson);
    EXPECT_EQ(active["project"]["schemaVersion"], "0.4.0");
    EXPECT_FALSE(active.contains("items")) << "a summary, the screens are loaded one by one";
    ASSERT_TRUE(active["screens"].is_array());
    EXPECT_EQ(active["screens"].size(), 2u);
    // the value tables that the bindings of the svg items use (directly and through the Tag)
    ASSERT_TRUE(active["valueTables"].is_object());
    EXPECT_TRUE(active["valueTables"].contains("TrangThaiBom"));
    // the files of the svg item, under graphics/, and the screen files; nothing else
    EXPECT_TRUE(a.allowlist.count("graphics/main.svg"));
    EXPECT_TRUE(a.allowlist.count("screens/main.svg1.bindings.json"));
    EXPECT_TRUE(a.allowlist.count("screens/main.screen.json"));
    EXPECT_FALSE(a.allowlist.count("tags.json"));
    EXPECT_FALSE(a.allowlist.count("project.json"));
    EXPECT_TRUE(a.model != nullptr);
}

TEST(StartupActive04, TheSvgIsServedAndAFileOutsideTheAllowlistIs404) {
    TagStore store;
    const ActiveProject a = activate("v04-valid-full", 10, store);
    ASSERT_TRUE(a.active) << a.info.dump();
    HttpApi::Options o;
    o.docroot = "/nonexistent";
    o.projectDir = kVectors + "/v04-valid-full";
    o.projectAllowlist = a.allowlist;
    o.activeProjectJson = a.activeJson;
    HttpApi api(o, [&] { return json{{"project", a.info}}; });
    test::TestServer server;
    ASSERT_NE(server.ctx, nullptr);
    api.install(server.ctx);

    const auto svg = test::httpGet(server.port, "/project/graphics/main.svg");
    EXPECT_EQ(svg.status, 200);
    EXPECT_NE(svg.body.find("data-mat-uid=\"el_aaa\""), std::string::npos);
    const auto bindings = test::httpGet(server.port, "/project/screens/main.svg1.bindings.json");
    EXPECT_EQ(bindings.status, 200);
    EXPECT_EQ(json::parse(bindings.body)["schemaVersion"], "0.4.0");
    // outside the allowlist: the Tag file, the project file, a traversal, a file that is no
    // item's, a directory
    for (const char* path :
         {"/project/tags.json", "/project/project.json", "/project/graphics/other.svg",
          "/project/../tags.json", "/project/graphics/", "/project/value-tables/TrangThaiBom.json"})
        EXPECT_EQ(test::httpGet(server.port, path).status, 404) << path;
}

TEST(StartupActive04, Projects03And01StillRunAndAnUnknownSchemaVersionIsRefused) {
    TagStore store;
    EXPECT_TRUE(activate("v03-valid-full", 10, store).active);
    EXPECT_TRUE(activate("valid-minimal", 10, store).active);
    for (const char* bad : {"v02-invalid-schema-version-0.5", "v02-invalid-schema-version-1.0"}) {
        TagStore s;
        const ActiveProject a = activate(bad, 10, s);
        EXPECT_FALSE(a.active) << bad;
        EXPECT_EQ(a.info["status"], "invalid") << bad;
        EXPECT_FALSE(a.errors.empty()) << bad;
    }
    // a 0.4 project that asks for a runtime newer than this one is not activated either
    TagStore s;
    const ActiveProject old =
        activateProject(validateProject(kVectors + "/v04-valid-full", kSchemas, "0.6.0"), 10, s);
    EXPECT_FALSE(old.active);
    EXPECT_EQ(old.errors[0]["code"], "E_RUNTIME_TOO_OLD");
}
