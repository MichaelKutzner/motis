#include "motis/endpoints/street_isochrones.h"

// #include <chrono>
// #include <vector>
//
#include "utl/verify.h"
//
// #include "net/bad_request_exception.h"
// #include "net/too_many_exception.h"
//
// #include "nigiri/common/delta_t.h"
// #include "nigiri/routing/limits.h"
// #include "nigiri/routing/one_to_all.h"
// #include "nigiri/routing/query.h"
// #include "nigiri/types.h"
//
// #include "motis-api/motis-api.h"
// #include "motis/endpoints/routing.h"
// #include "motis/gbfs/routing_data.h"
#include "motis/metrics_registry.h"
// #include "motis/place.h"
// #include "motis/timetable/modes_to_clasz_mask.h"

namespace motis::ep {

namespace n = nigiri;

api::Isochrones street_isochrones::operator()(
    boost::urls::url_view const& url) const {
  metrics_->routing_requests_.Increment();

  auto const query = api::streetIsochrones_params{url.params()};
  fmt::println("MaxDurations: {}", query.maxDuration_);
  fmt::println("Places: {}", query.places_);
  utl::verify(
      query.places_.size() == query.maxDuration_.size(),
      "Number of places does not match number of maxDurations ({} != {})",
      query.places_.size(), query.maxDuration_.size());
  auto isochrones = api::Isochrones{};
  return isochrones;
}

}  // namespace motis::ep
