#include "core/project-manager/rules_04.hpp"

namespace mat {

void bindingRules04(const nlohmann::json&, const std::string&, const std::set<std::string>&,
                    const Binding04Ctx&, const BindingAdd&, const BindingAdd&) {}

size_t countAnimations04(const nlohmann::json&) { return 0; }

}  // namespace mat
