// The widget catalog (feature 007; specs/007-screens-widgets/contracts/widget-catalog.md): which
// widgets exist, their Tag slots, properties, events and roles. One source,
// schemas/widgets.catalog.json, read by the TypeScript validator, the Studio and this one (the same
// vectors: tests/widget-catalog-vectors). Nothing about a widget type is written in the rules.
// Loaded once from the schemas directory and kept in memory.
#pragma once
#include <memory>
#include <optional>
#include <string>
#include <vector>

#include "nlohmann/json.hpp"

namespace mat {

struct SlotSpec {
    std::string name;
    bool required = false;
    bool multi = false;
    std::optional<int> max;
    std::vector<std::string> types;  // number | bool | string
    bool needsWrite = false;
};

struct EventSpec {
    std::string name;
    std::vector<std::string> actions;
};

struct WidgetSpec {
    std::string id;
    std::string group;  // display | chart | table | control
    int minWidth = 0;
    int minHeight = 0;
    std::vector<SlotSpec> slots;
    std::vector<nlohmann::json> props;  // as in the file: name, kind, limits, fromTag ...
    std::vector<EventSpec> events;
    bool hasSecurity = false;
    std::vector<std::string> minRoles;

    const SlotSpec* slot(const std::string& name) const;
    const nlohmann::json* prop(const std::string& name) const;
};

class WidgetCatalog {
   public:
    // <schemasDir>/widgets.catalog.json; nullptr and `error` when it cannot be read or is not a
    // catalog.
    static std::unique_ptr<WidgetCatalog> loadFromDir(const std::string& schemasDir,
                                                      std::string& error);
    static std::unique_ptr<WidgetCatalog> fromJson(const nlohmann::json& doc, std::string& error);

    const WidgetSpec* find(const std::string& id) const;
    const std::string& version() const { return version_; }
    const std::vector<WidgetSpec>& widgets() const { return widgets_; }

   private:
    std::string version_;
    std::vector<WidgetSpec> widgets_;
};

// "number", "bool" or "string" for a Tag type of tags.json.
std::string tagClassOf(const std::string& tagType);

// "" when `value` is valid for the property `spec` (an element of "props", or of "fields" or
// "items"); otherwise a short English reason. The rules give it the code E_WIDGET_PROP.
std::string checkPropValue(const nlohmann::json& spec, const nlohmann::json& value);

// Length in Unicode code points (the unit of maxLength).
size_t codePointCount(const std::string& utf8);

}  // namespace mat
