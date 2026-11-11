# PlatformIO routes -flto in build_flags to compilation only.
# The GCC link driver must also load its matching LTO plugin.
Import("env")
env.Append(LINKFLAGS=["-flto", "-fuse-linker-plugin"])
