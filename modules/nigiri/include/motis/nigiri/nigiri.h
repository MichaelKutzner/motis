#pragma once

#include <memory>
#include <string>
#include <vector>

#include "geo/latlng.h"

#include "cista/containers/mmap_vec.h"
#include "cista/containers/vecvec.h"
#include "cista/mmap.h"

#include "motis/module/module.h"

namespace motis::nigiri {

// Duplicated from nigiri/types.h
template <typename T>
using mm_vec = ::cista::basic_mmap_vec<T, std::uint64_t>;

template <typename Key, typename V, typename SizeType = ::cista::base_t<Key>>
using mm_vecvec = cista::basic_vecvec<Key, mm_vec<V>, mm_vec<SizeType>>;

struct nigiri : public motis::module::module {
  nigiri();
  ~nigiri() override;

  nigiri(nigiri const&) = delete;
  nigiri& operator=(nigiri const&) = delete;

  nigiri(nigiri&&) = delete;
  nigiri& operator=(nigiri&&) = delete;

  void init(motis::module::registry&) override;
  void import(motis::module::import_dispatcher&) override;
  bool import_successful() const override { return import_successful_; }

private:
  void register_gtfsrt_timer(motis::module::dispatcher&);
  void update_gtfsrt();

  bool import_successful_{false};

  struct impl;
  std::unique_ptr<impl> impl_;
  bool no_cache_{false};
  bool adjust_footpaths_{true};
  bool merge_duplicates_{false};
  unsigned max_footpath_length_{std::numeric_limits<std::uint16_t>::max()};
  std::string first_day_{"TODAY"};
  std::string default_timezone_;
  std::uint16_t num_days_{2U};
  bool lookup_{true};
  bool guesser_{true};
  bool railviz_{true};
  bool routing_{true};
  unsigned link_stop_distance_{100U};
  std::vector<std::string> gtfsrt_urls_;
  std::vector<std::string> gtfsrt_paths_;
  unsigned gtfsrt_update_interval_sec_{60U};
  bool gtfsrt_incremental_{false};
  bool debug_{false};
  bool bikes_allowed_default_{false};
  std::unique_ptr<mm_vecvec<uint32_t, ::geo::latlng>> shape_vecvec_{};
};

inline mm_vecvec<uint32_t, ::geo::latlng> create_mmap(std::string path, ::cista::mmap::protection const mode = ::cista::mmap::protection::WRITE) {
  auto data_path = path + ".data";
  auto metadata_path = path + ".metadata";
  return {::cista::basic_mmap_vec<geo::latlng, std::uint64_t>{
              ::cista::mmap{data_path.data(), mode}},
          ::cista::basic_mmap_vec<cista::base_t<uint32_t>, std::uint64_t>{
              ::cista::mmap{metadata_path.data(), mode}}};
}

}  // namespace motis::nigiri
