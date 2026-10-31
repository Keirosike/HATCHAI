#pragma once
#include <stddef.h>
namespace HatchAccess {
constexpr bool loginAllowed(bool passwordSupplied,bool matches) { return passwordSupplied && matches; }
constexpr bool tokenAllowed(bool active,size_t length,bool matches) { return active && length>=8 && length<=96 && matches; }
}
