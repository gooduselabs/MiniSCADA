// Helpers shared by the parts of the engineering API (engineering_api.cpp: device and sign-in;
// engineering_api_project.cpp: the project routes of US2). Not a public interface.
#pragma once
#include <string>

#include "nlohmann/json.hpp"

struct mg_connection;

namespace mat::eapi {

// The headers of device-api §1.2 on every answer; `extra` adds whole header lines. 204 has neither
// a body nor its content headers. Returns `status`.
int send(mg_connection* c, int status, const std::string& body, bool close,
         const std::string& extra = "");

// {"error": code, "message": …, …more}: the message is gateMessage(code) unless `more` has one.
int sendError(mg_connection* c, int status, const std::string& code, bool close,
              const std::string& extra = "", nlohmann::json more = nlohmann::json::object());

// The whole body of a request whose Content-Length is within the limit (checked before). false
// when the client stops sending (request_timeout_ms) or the connection fails.
bool readBody(mg_connection* c, std::string& out);

// Reads and drops what is left of the body, so that an answer sent before the whole body reaches
// the client and the connection can serve the next request.
void drain(mg_connection* c);

}  // namespace mat::eapi
