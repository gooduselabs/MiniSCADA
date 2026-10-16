// T129 red phase: the interface only (nothing is sent, nothing is audited).
#include "server/logic_glue.hpp"

namespace mat {

struct LogicSubsystem::Pending {};

std::vector<std::pair<std::string, TagType>> logicRetainKeys(const nlohmann::json&) { return {}; }
logic::RetainMap logicRetainFromStore(const std::map<std::string, RetainValue>&) { return {}; }
RetainValue logicRetainToStore(const std::string&, const nlohmann::json&) { return {}; }

LogicSubsystem::LogicSubsystem(const ProjectModel& model, const nlohmann::json& doc,
                               LogicOptions options, const logic::RetainMap&, bool retainLost)
    : model_(model), doc_(doc), opt_(std::move(options)), retainLost_(retainLost) {}
LogicSubsystem::~LogicSubsystem() = default;
void LogicSubsystem::setCoordinator(WriteCoordinator* c) { coordinator_ = c; }
void LogicSubsystem::round(EngineRound&) {}
std::vector<std::pair<std::string, RetainValue>> LogicSubsystem::retainDue(bool) { return {}; }
nlohmann::json LogicSubsystem::status() { return {{"blocks", nlohmann::json::array()}}; }
std::string LogicSubsystem::writesState() { return ""; }
bool LogicSubsystem::stopWrites(const WriteCaller&, std::string& code) {
    code = "NOT_IMPLEMENTED";
    return false;
}
bool LogicSubsystem::reset(const std::string&, double, const WriteCaller&, std::string& code) {
    code = "NOT_IMPLEMENTED";
    return false;
}
void LogicSubsystem::waitIdle() {}
void LogicSubsystem::stop() {}

}  // namespace mat
