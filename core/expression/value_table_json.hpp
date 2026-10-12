// ValueTable <- JSON (value-tables/<name>.json and the shared vectors). The schema has already
// checked the file; this reader is tolerant and never throws on a well-typed value.
#pragma once
#include "core/expression/expression.hpp"
#include "nlohmann/json.hpp"

namespace mat::expr {

ValueTable valueTableFromJson(const nlohmann::json& j);

}  // namespace mat::expr
