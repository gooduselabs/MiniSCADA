// Client libraries of the external databases are loaded at run time, never linked
// (specs/003-data-logging research R7): `<dir>/<soname>` first (libraries shipped with the
// runtime), then the system loader. RTLD_NOW | RTLD_LOCAL; a loaded library is never closed.
#pragma once
#include <dlfcn.h>

#include <string>

namespace mat {

// nullptr + err (the dlerror text) when neither path loads.
void* openClientLib(const std::string& dir, const char* soname, std::string& err);

// Resolves function pointers; remembers the first missing name.
class SymbolTable {
   public:
    explicit SymbolTable(void* handle) : h_(handle) {}
    template <class F>
    void get(F& fn, const char* name) {
        void* p = ::dlsym(h_, name);
        if (!p && missing_.empty()) missing_ = name;
        fn = reinterpret_cast<F>(p);
    }
    bool ok() const { return missing_.empty(); }
    const std::string& missing() const { return missing_; }

   private:
    void* h_;
    std::string missing_;
};

}  // namespace mat
