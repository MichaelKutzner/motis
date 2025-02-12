#pragma once

#include "boost/json/object.hpp"
#include "boost/url/url_view.hpp"

namespace motis::ep {

using object = boost::json::object;

struct heartbeat {
  object operator()(boost::urls::url_view const&) const { return object{}; }
};

}  // namespace motis::ep
