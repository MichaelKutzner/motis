#pragma once

#include <format>

#include "boost/json/object.hpp"
#include "boost/url/url_view.hpp"

#include "motis/version.h"

namespace motis::ep {

using object = boost::json::object;

struct version {
  object operator()(boost::urls::url_view const&) const {
    return object{{{"version", std::format("MOTIS {}", motis_version)}}};
  }
};

}  // namespace motis::ep
