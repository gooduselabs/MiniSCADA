// JSON text for clients. Text from devices and database servers may hold bytes that are not
// UTF-8: they become U+FFFD instead of an exception that would end the runtime
// (specs/003-data-logging security review M4).
#pragma once
#include <string>

#include "nlohmann/json.hpp"

namespace mat {

inline std::string jsonText(const nlohmann::json& j) {
    return j.dump(-1, ' ', false, nlohmann::json::error_handler_t::replace);
}

}  // namespace mat
