#pragma once

#include <memory>

#include "cista/containers/mmap_vec.h"
#include "cista/mmap.h"

#include "geo/box.h"
#include "geo/latlng.h"

#include "nigiri/types.h"

#include "motis/module/message.h"

namespace nigiri {
struct timetable;
struct rt_timetable;
}  // namespace nigiri

namespace motis::nigiri {

using shape_data = std::unique_ptr<::nigiri::shape_vecvec_t>;

struct tag_lookup;

struct railviz {
  railviz(tag_lookup const&, ::nigiri::timetable const&, shape_data&&);
  ~railviz();

  module::msg_ptr get_trains(module::msg_ptr const&) const;
  module::msg_ptr get_trips(module::msg_ptr const&) const;

  void update(std::shared_ptr<::nigiri::rt_timetable> const&) const;

  struct impl;
  std::unique_ptr<impl> impl_;
};

inline shape_data open_shape(std::string const& path,
                             ::cista::mmap::protection const mode) {
  auto const data_path = path + ".data";
  auto const metadata_path = path + ".metadata";
  using t = shape_data::element_type;
  return std::make_unique<t>(
      t{::cista::basic_mmap_vec<geo::latlng, std::uint64_t>{
            ::cista::mmap{data_path.data(), mode}},
        ::cista::basic_mmap_vec<cista::base_t<::nigiri::shape_idx_t>,
                                std::uint64_t>{
            ::cista::mmap{metadata_path.data(), mode}}});
}

}  // namespace motis::nigiri