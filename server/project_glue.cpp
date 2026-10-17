#include "server/project_glue.hpp"

#include <algorithm>

#include "core/package/extract.hpp"
#include "core/package/project_digest.hpp"
#include "core/package/zip_reader.hpp"
#include "core/package/zip_writer.hpp"

namespace mat {

VerifyOutcome verifyPackageStep(const VerifyRequest& req, const PackageSchema& schema) {
    VerifyOutcome out;
    std::string error;
    const auto src = FileSource::open(req.packagePath, error);
    if (!src) {
        out.code = "STORE_IO";
        out.message = "không đọc được gói đã nhận: " + error;
        return out;
    }
    ExtractOptions options;
    options.expectedDigest = req.expectedDigest;
    options.minFreeBytes = req.minFreeBytes;
    const PackageCheck r = extractPackage(*src, schema, req.projectDir, options);
    if (!r.ok) {
        out.code = r.error.code;
        out.path = r.error.path;
        out.message = r.error.message;
        return out;
    }
    out.ok = true;
    out.digest = r.manifest.digest;
    out.projectId = r.manifest.projectId;
    out.projectName = r.manifest.projectName;
    out.projectVersion = r.manifest.projectVersion;
    out.minRuntimeVersion = r.manifest.minRuntimeVersion;
    return out;
}

ValidateOutcome validateStep(const std::string& projectDir, const std::string& schemasDir,
                             const SerialPolicy* serial) {
    const ProjectValidation v = validateProject(projectDir, schemasDir, kRuntimeVersion, serial);
    ValidateOutcome out;
    out.ok = v.valid;
    out.issues = v.errors;
    if (!v.valid || !v.project) return out;
    // Feature 011 (T023, FR-024, research R9): the directory holds exactly the project's files, so
    // the digest the runtime shows (projectDirDigest over files()) is the package digest and the
    // health check after the restart finds it.
    std::string error;
    const auto extra = projectExtraFiles(projectDir, v.project->files(), &error);
    if (!extra || !extra->empty()) {
        out.ok = false;
        out.code = "E_PACKAGE_EXTRA_FILE";
        if (!extra) {
            out.issues.push_back(
                {"E_PACKAGE_EXTRA_FILE", "", "", "Không đọc được thư mục: " + error});
            return out;
        }
        std::string list;
        const size_t shown = std::min<size_t>(extra->size(), 20);
        for (size_t i = 0; i < shown; ++i) list += (i ? ", " : "") + (*extra)[i];
        if (extra->size() > shown)
            list += " (và " + std::to_string(extra->size() - shown) + " tệp khác)";
        for (size_t i = 0; i < shown; ++i)
            out.issues.push_back(
                {"E_PACKAGE_EXTRA_FILE", (*extra)[i], "",
                 i == 0 ? "Tệp không thuộc project (project không tham chiếu): " + list
                        : "Tệp không thuộc project"});
    }
    return out;
}

PackFn storedPackFn(std::function<int64_t()> wallMs) {
    return [wallMs = std::move(wallMs)](const std::string& dir,
                                        const std::vector<std::string>& files, int fd) {
        std::vector<PackageInput> inputs;
        inputs.reserve(files.size());
        for (const auto& f : files) inputs.push_back(fileInput(f, dir + "/" + f));
        FdSink sink(fd);
        PackageWriteOptions options;
        options.createdAt = isoUtc(wallMs ? wallMs() : systemWallMs());
        const PackageWriteResult w = writeStoredPackage(std::move(inputs), options, sink);
        PackResult p;
        p.ok = w.ok;
        if (!w.ok)
            p.error = w.error.code + (w.error.path.empty() ? "" : " " + w.error.path) +
                      (w.error.message.empty() ? "" : ": " + w.error.message);
        p.digest = w.digest;
        p.bytes = w.bytes;
        return p;
    };
}

LegacyProject legacyProjectOf(const ProjectValidation& v, const std::string& dir) {
    LegacyProject l;
    l.dir = dir;
    if (v.valid && v.project) {
        const nlohmann::json& p = v.project->project;
        l.status = LegacyStatus::Valid;
        l.files = v.project->files();
        l.projectId = p.value("projectId", "");
        l.projectName = p.value("projectName", "");
        l.projectVersion = p.value("projectVersion", "");
        l.minRuntimeVersion = p.value("minRuntimeVersion", "");
        return l;
    }
    if (!v.errors.empty() && v.errors[0].code == "E_FILE_MISSING" &&
        v.errors[0].file == "project.json") {
        l.status = LegacyStatus::Empty;
        l.reason = "thư mục " + dir + " không có project.json";
        return l;
    }
    l.status = LegacyStatus::Invalid;
    if (v.errors.empty()) {
        l.reason = "project không hợp lệ";
    } else {
        const ProjectIssue& e = v.errors[0];
        l.reason = e.code + (e.file.empty() ? "" : " " + e.file) + ": " + e.message;
        if (v.errors.size() > 1)
            l.reason += " (và " + std::to_string(v.errors.size() - 1) + " lỗi khác)";
    }
    return l;
}

nlohmann::json operationInfoJson(const std::optional<DeployOperation>& op) {
    if (!op || op->result != DeployResult::Running) return nullptr;
    std::string step = op->runningStep();
    if (step.empty()) {
        for (const auto& s : op->steps)
            if (s.state == StepState::Ok || s.state == StepState::Failed) step = s.id;
    }
    if (step.empty()) step = kStepReceive;
    return {{"kind", opKindName(op->kind)}, {"step", step}, {"since", op->startedMs}};
}

}  // namespace mat
