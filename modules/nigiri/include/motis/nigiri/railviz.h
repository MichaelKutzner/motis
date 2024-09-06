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

using shape_data = std::unique_ptr<::nigiri::shapes_storage_t>;

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

}  // namespace motis::nigiri