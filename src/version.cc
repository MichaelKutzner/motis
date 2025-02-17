#include "motis/version.h"

#if defined(MOTIS_VERSION)
std::string_view const motis_version{MOTIS_VERSION};
#else
std::string_view const motis_version{"unknown"};
#endif
