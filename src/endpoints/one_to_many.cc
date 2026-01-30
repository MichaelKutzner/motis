#include "motis/endpoints/one_to_many.h"

#include <optional>

#include "nigiri/common/delta_t.h"
#include "nigiri/routing/one_to_all.h"
#include "nigiri/routing/one_to_many.h"

#include "motis/endpoints/routing.h"
#include "motis/gbfs/routing_data.h"
#include "motis/metrics_registry.h"
#include "motis/timetable/modes_to_clasz_mask.h"

namespace motis::ep {

namespace n = nigiri;

api::oneToMany_response one_to_many::operator()(
    boost::urls::url_view const& url) const {
  auto const query = api::oneToMany_params{url.params()};
  return one_to_many_handle_request(query, w_, l_, elevations_);
}

template <typename Endpoint, typename Query>
api::oneToManyIm_response run_one_to_many_im(Endpoint const& ep,
                                             Query const& query) {
  ep.metrics_->routing_requests_.Increment();

  auto const time = std::chrono::time_point_cast<std::chrono::minutes>(
      *query.time_.value_or(openapi::now()));
  auto const max_travel_time = n::duration_t{query.maxTravelTime_};

  auto const one = parse_location(query.one_, ';');
  utl::verify(one.has_value(), "{} is not a valid geo coordinate", query.one_);

  auto const many = utl::to_vec(query.many_, [](auto&& x) {
    auto const y = parse_location(x, ';');
    utl::verify(y.has_value(), "{} is not a valid geo coordinate", x);
    return *y;
  });

  auto const one_modes = deduplicate(query.arriveBy_ ? query.postTransitModes_
                                                     : query.preTransitModes_);
  auto const many_modes = deduplicate(
      query.arriveBy_ ? query.preTransitModes_ : query.postTransitModes_);
  auto const max_travel_time_limit = std::min(
      std::chrono::duration_cast<std::chrono::seconds>(max_travel_time),
      std::chrono::seconds{ep.config_.limits_.value()
                               .street_routing_max_prepost_transit_seconds_});
  auto const one_max_time =
      std::min(std::chrono::seconds{query.arriveBy_ ? query.maxPostTransitTime_
                                                    : query.maxPreTransitTime_},
               max_travel_time_limit);
  auto const many_max_time = std::min(
      std::chrono::seconds{query.arriveBy_ ? query.maxPreTransitTime_
                                           : query.maxPostTransitTime_},
      max_travel_time_limit);
  auto const one_dir =
      query.arriveBy_ ? osr::direction::kBackward : osr::direction::kForward;
  auto const many_dir =
      query.arriveBy_ ? osr::direction::kForward : osr::direction::kBackward;

  auto const r = routing{ep.config_,     ep.w_,   ep.l_,       ep.pl_,
                         ep.elevations_, &ep.tt_, nullptr,     &ep.tags_,
                         ep.loc_tree_,   ep.fa_,  ep.matches_, ep.way_matches_,
                         ep.rt_,         nullptr, ep.gbfs_,    nullptr,
                         nullptr,        nullptr, nullptr,     ep.metrics_};
  auto gbfs_rd = gbfs::gbfs_routing_data{ep.w_, ep.l_, ep.gbfs_};

  auto const osr_params = get_osr_parameters(query);
  auto prepare_stats = std::map<std::string, std::uint64_t>{};

  auto const many_offsets = utl::to_vec(many, [&](osr::location const& l) {
    return r.get_offsets(nullptr, l, many_dir, many_modes, std::nullopt,
                         std::nullopt, std::nullopt, std::nullopt, false,
                         osr_params, query.pedestrianProfile_,
                         query.elevationCosts_, many_max_time,
                         query.maxMatchingDistance_, gbfs_rd, prepare_stats);
  });

  auto q = n::routing::query{
      .start_time_ = time,
      .start_match_mode_ = get_match_mode(*one),
      .start_ = r.get_offsets(
          nullptr, *one, one_dir, one_modes, std::nullopt, std::nullopt,
          std::nullopt, std::nullopt, false, osr_params,
          query.pedestrianProfile_, query.elevationCosts_, one_max_time,
          query.maxMatchingDistance_, gbfs_rd, prepare_stats),
      .td_start_ = r.get_td_offsets(
          nullptr, nullptr, *one, one_dir, one_modes, osr_params,
          query.pedestrianProfile_, query.elevationCosts_,
          query.maxMatchingDistance_, one_max_time, time, prepare_stats),
      .max_transfers_ = static_cast<std::uint8_t>(
          query.maxTransfers_.value_or(n::routing::kMaxTransfers)),
      .max_travel_time_ = max_travel_time,
      .prf_idx_ = static_cast<n::profile_idx_t>(
          query.useRoutedTransfers_
              ? (query.pedestrianProfile_ ==
                         api::PedestrianProfileEnum::WHEELCHAIR
                     ? 2U
                     : 1U)
              : 0U),
      .allowed_claszes_ = to_clasz_mask(query.transitModes_),
      .require_bike_transport_ = query.requireBikeTransport_,
      .require_car_transport_ = query.requireCarTransport_,
      .transfer_time_settings_ =
          n::routing::transfer_time_settings{
              .default_ = (query.minTransferTime_ == 0 &&
                           query.additionalTransferTime_ == 0 &&
                           query.transferTimeFactor_ == 1.0),
              .min_transfer_time_ = n::duration_t{query.minTransferTime_},
              .additional_time_ = n::duration_t{query.additionalTransferTime_},
              .factor_ = static_cast<float>(query.transferTimeFactor_)},
  };

  if (ep.tt_.locations_.footpaths_out_.at(q.prf_idx_).empty()) {
    q.prf_idx_ = 0U;
  }
  auto const durations =
      query.arriveBy_
          ? n::routing::one_to_many<n::direction::kBackward>(
                ep.tt_, nullptr, many_offsets, q)  // TODO Support RT
          : n::routing::one_to_many<n::direction::kForward>(ep.tt_, nullptr,
                                                            many_offsets, q);
  return utl::to_vec(
      durations, [&](std::optional<n::duration_t> const duration) {
        return duration.has_value()
                   ? api::Duration{.duration_ = duration->count()}
                   : api::Duration{};
      });
}

template <typename Endpoint, typename Query>
api::oneToManyIm_response run_one_to_many_im2(Endpoint const& ep,
                                              Query const& query) {
  ep.metrics_->routing_requests_.Increment();

  auto const time = std::chrono::time_point_cast<std::chrono::minutes>(
      *query.time_.value_or(openapi::now()));
  auto const max_travel_time = n::duration_t{query.maxTravelTime_};

  auto const one = parse_location(query.one_, ';');
  utl::verify(one.has_value(), "{} is not a valid geo coordinate", query.one_);

  auto const many = utl::to_vec(query.many_, [](auto&& x) {
    auto const y = parse_location(x, ';');
    utl::verify(y.has_value(), "{} is not a valid geo coordinate", x);
    return *y;
  });

  auto const one_modes = deduplicate(query.arriveBy_ ? query.postTransitModes_
                                                     : query.preTransitModes_);
  auto const many_modes = deduplicate(
      query.arriveBy_ ? query.preTransitModes_ : query.postTransitModes_);
  auto const max_travel_time_limit = std::min(
      std::chrono::duration_cast<std::chrono::seconds>(max_travel_time),
      std::chrono::seconds{ep.config_.limits_.value()
                               .street_routing_max_prepost_transit_seconds_});
  auto const one_max_time =
      std::min(std::chrono::seconds{query.arriveBy_ ? query.maxPostTransitTime_
                                                    : query.maxPreTransitTime_},
               max_travel_time_limit);
  auto const many_max_time = std::min(
      std::chrono::seconds{query.arriveBy_ ? query.maxPreTransitTime_
                                           : query.maxPostTransitTime_},
      max_travel_time_limit);
  auto const one_dir =
      query.arriveBy_ ? osr::direction::kBackward : osr::direction::kForward;
  auto const many_dir =
      query.arriveBy_ ? osr::direction::kForward : osr::direction::kBackward;

  auto const r = routing{ep.config_,     ep.w_,   ep.l_,       ep.pl_,
                         ep.elevations_, &ep.tt_, nullptr,     &ep.tags_,
                         ep.loc_tree_,   ep.fa_,  ep.matches_, ep.way_matches_,
                         ep.rt_,         nullptr, ep.gbfs_,    nullptr,
                         nullptr,        nullptr, nullptr,     ep.metrics_};
  auto gbfs_rd = gbfs::gbfs_routing_data{ep.w_, ep.l_, ep.gbfs_};

  auto const osr_params = get_osr_parameters(query);
  auto prepare_stats = std::map<std::string, std::uint64_t>{};

  auto const many_offsets = utl::to_vec(many, [&](osr::location const& l) {
    return r.get_offsets(nullptr, l, many_dir, many_modes, std::nullopt,
                         std::nullopt, std::nullopt, std::nullopt, false,
                         osr_params, query.pedestrianProfile_,
                         query.elevationCosts_, many_max_time,
                         query.maxMatchingDistance_, gbfs_rd, prepare_stats);
  });

  auto q = n::routing::query{
      .start_time_ = time,
      .start_match_mode_ = get_match_mode(*one),
      .start_ = r.get_offsets(
          nullptr, *one, one_dir, one_modes, std::nullopt, std::nullopt,
          std::nullopt, std::nullopt, false, osr_params,
          query.pedestrianProfile_, query.elevationCosts_, one_max_time,
          query.maxMatchingDistance_, gbfs_rd, prepare_stats),
      .td_start_ = r.get_td_offsets(
          nullptr, nullptr, *one, one_dir, one_modes, osr_params,
          query.pedestrianProfile_, query.elevationCosts_,
          query.maxMatchingDistance_, one_max_time, time, prepare_stats),
      .max_transfers_ = static_cast<std::uint8_t>(
          query.maxTransfers_.value_or(n::routing::kMaxTransfers)),
      .max_travel_time_ = max_travel_time,
      .prf_idx_ = static_cast<n::profile_idx_t>(
          query.useRoutedTransfers_
              ? (query.pedestrianProfile_ ==
                         api::PedestrianProfileEnum::WHEELCHAIR
                     ? 2U
                     : 1U)
              : 0U),
      .allowed_claszes_ = to_clasz_mask(query.transitModes_),
      .require_bike_transport_ = query.requireBikeTransport_,
      .require_car_transport_ = query.requireCarTransport_,
      .transfer_time_settings_ =
          n::routing::transfer_time_settings{
              .default_ = (query.minTransferTime_ == 0 &&
                           query.additionalTransferTime_ == 0 &&
                           query.transferTimeFactor_ == 1.0),
              .min_transfer_time_ = n::duration_t{query.minTransferTime_},
              .additional_time_ = n::duration_t{query.additionalTransferTime_},
              .factor_ = static_cast<float>(query.transferTimeFactor_)},
  };

  if (ep.tt_.locations_.footpaths_out_.at(q.prf_idx_).empty()) {
    q.prf_idx_ = 0U;
  }
  // Up to now same as one_to_many_im
  auto const state =
      query.arriveBy_
          ? n::routing::one_to_all<n::direction::kBackward>(
                ep.tt_, nullptr, q)  // TODO Support RT
          : n::routing::one_to_all<n::direction::kForward>(ep.tt_, nullptr, q);

  auto const unreachable = query.arriveBy_
                               ? nigiri::kInvalidDelta<n::direction::kBackward>
                               : nigiri::kInvalidDelta<n::direction::kForward>;
  auto reachable = nigiri::bitvec{ep.tt_.n_locations()};
  for (auto i = 0U; i != ep.tt_.n_locations(); ++i) {
    if (state.template get_best<0>()[i][0] != unreachable) {
      reachable.set(i);
    }
  }
  auto const dir =
      query.arriveBy_ ? n::direction::kBackward : n::direction::kForward;
  return utl::to_vec(
      many_offsets,
      [&](std::vector<n::routing::offset> const& offsets) -> api::Duration {
        auto best = unreachable;
        for (auto const offset : offsets) {
          auto const loc = offset.target();
          if (reachable.test(to_idx(loc))) {
            auto const fastest = n::routing::get_fastest_one_to_all_offsets(
                ep.tt_, state, dir, loc, time, q.max_transfers_);
            auto const total = static_cast<n::delta_t>(
                fastest.duration_ + offset.duration().count());
            if (total < best) {
              best = total;
            }
          }
        }
        return best < unreachable ? api::Duration{best} : api::Duration{};
      });
}

api::oneToManyIm_response one_to_many_im::operator()(
    boost::urls::url_view const& url) const {
  fmt::println("GET(1)");
  auto const query = api::oneToManyIm_params{url.params()};
  return run_one_to_many_im(*this, query);
}

api::oneToManyIm_response one_to_many_im2::operator()(
    boost::urls::url_view const& url) const {
  fmt::println("GET(2)");
  auto const query = api::oneToManyIm_params{url.params()};
  return run_one_to_many_im2(*this, query);
}

// POST

api::oneToManyIm_response one_to_many_im_post::operator()(
    api::OneToManyImParams const& query) const {
  fmt::println("POST(1)");
  return run_one_to_many_im(*this, query);
}
api::oneToManyIm_response one_to_many_im2_post::operator()(
    api::OneToManyImParams const& query) const {
  fmt::println("POST(2)");
  return run_one_to_many_im2(*this, query);
}

}  // namespace motis::ep
