#pragma once

#include <memory>

#include "cista/containers/mmap_vec.h"
#include "cista/mmap.h"

#include "geo/box.h"

#include "nigiri/types.h"
#include "nigiri/types2.h"

#include "motis/module/message.h"

namespace nigiri {
struct timetable;
struct rt_timetable;
}  // namespace nigiri

namespace motis::nigiri {

using shape_ptr = std::unique_ptr<mm_vecvec<uint32_t, ::geo::latlng>>;

struct tag_lookup;

struct railviz {
  railviz(tag_lookup const&, ::nigiri::timetable const&, shape_ptr&&);
  ~railviz();

  module::msg_ptr get_trains(module::msg_ptr const&) const;
  module::msg_ptr get_trips(module::msg_ptr const&) const;

  void update(std::shared_ptr<::nigiri::rt_timetable> const&) const;

  struct impl;
  std::unique_ptr<impl> impl_;
};

inline shape_ptr open_shape(std::string path,
                            ::cista::mmap::protection const mode) {
  auto data_path = path + ".data";
  auto metadata_path = path + ".metadata";
  return std::make_unique<shape_ptr::element_type>(
      ::cista::basic_mmap_vec<geo::latlng, std::uint64_t>{
          ::cista::mmap{data_path.data(), mode}},
      ::cista::basic_mmap_vec<cista::base_t<uint32_t>, std::uint64_t>{
          ::cista::mmap{metadata_path.data(), mode}});
}

}  // namespace motis::nigiri