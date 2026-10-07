# Loaded only by the production Android build. Keep checkout/cache/SDK paths
# out of compiled file names and object DWARF. Final links omit debug metadata.
if(NOT DEFINED CRYPTEX_GRADLE_USER_HOME OR NOT DEFINED CRYPTEX_ANDROID_SDK_ROOT)
  message(FATAL_ERROR "Production native path maps require Gradle and SDK roots")
endif()

get_filename_component(CRYPTEX_WORKSPACE_ROOT "${CMAKE_CURRENT_LIST_DIR}/../.." REALPATH)
get_filename_component(CRYPTEX_GRADLE_ROOT "${CRYPTEX_GRADLE_USER_HOME}" REALPATH)
get_filename_component(CRYPTEX_SDK_ROOT "${CRYPTEX_ANDROID_SDK_ROOT}" REALPATH)
get_filename_component(CRYPTEX_BUILD_ROOT "${CMAKE_BINARY_DIR}" REALPATH)

# Gradle worker limits do not cap Ninja's compiler processes. Keep any existing
# pools, and bound production compilation/linking without changing compiler flags.
get_property(CRYPTEX_NATIVE_POOLS GLOBAL PROPERTY JOB_POOLS)
if(NOT CRYPTEX_NATIVE_POOLS AND DEFINED CMAKE_JOB_POOLS)
  set_property(GLOBAL PROPERTY JOB_POOLS "${CMAKE_JOB_POOLS}")
  set(CRYPTEX_NATIVE_POOLS "${CMAKE_JOB_POOLS}")
endif()
if(DEFINED CRYPTEX_NATIVE_JOBS)
  if(NOT CRYPTEX_NATIVE_JOBS MATCHES "^[1-9][0-9]*$")
    message(FATAL_ERROR "Invalid native build job count")
  endif()
  if(NOT "cryptex_compile=${CRYPTEX_NATIVE_JOBS}" IN_LIST CRYPTEX_NATIVE_POOLS)
    set_property(GLOBAL APPEND PROPERTY JOB_POOLS "cryptex_compile=${CRYPTEX_NATIVE_JOBS}")
  endif()
  if(NOT "cryptex_link=${CRYPTEX_NATIVE_JOBS}" IN_LIST CRYPTEX_NATIVE_POOLS)
    set_property(GLOBAL APPEND PROPERTY JOB_POOLS "cryptex_link=${CRYPTEX_NATIVE_JOBS}")
  endif()
else()
  if(NOT "cryptex_compile=2" IN_LIST CRYPTEX_NATIVE_POOLS)
    set_property(GLOBAL APPEND PROPERTY JOB_POOLS cryptex_compile=2)
  endif()
  if(NOT "cryptex_link=1" IN_LIST CRYPTEX_NATIVE_POOLS)
    set_property(GLOBAL APPEND PROPERTY JOB_POOLS cryptex_link=1)
  endif()
endif()
set(CMAKE_JOB_POOL_COMPILE cryptex_compile)
set(CMAKE_JOB_POOL_LINK cryptex_link)

# Only accelerated local builds supply this launcher. Clean/F-Droid builds keep
# the pinned make invocation and never modify the dependency patch or pnpm store.
if(DEFINED CRYPTEX_OPENSSL_MAKE)
  set(OPENSSL_MAKE "${CRYPTEX_OPENSSL_MAKE}" CACHE FILEPATH "Local OpenSSL make launcher" FORCE)
endif()

# Clang's file-prefix-map covers both __FILE__ and debug-prefix-map. Applying
# directory compile options preserves existing C/C++/ASM optimization flags.
add_compile_options(
  "$<$<COMPILE_LANGUAGE:C,CXX,ASM>:-ffile-prefix-map=${CRYPTEX_WORKSPACE_ROOT}=/src>"
  "$<$<COMPILE_LANGUAGE:C,CXX,ASM>:-ffile-prefix-map=${CRYPTEX_GRADLE_ROOT}=/gradle>"
  "$<$<COMPILE_LANGUAGE:C,CXX,ASM>:-ffile-prefix-map=${CRYPTEX_SDK_ROOT}=/android-sdk>"
  "$<$<COMPILE_LANGUAGE:C,CXX,ASM>:-ffile-prefix-map=${CRYPTEX_BUILD_ROOT}=/build/${CMAKE_PROJECT_NAME}>"
  "$<$<COMPILE_LANGUAGE:C,CXX,ASM>:-ffile-prefix-map=${CMAKE_BINARY_DIR}=/build/${CMAKE_PROJECT_NAME}>"
  # Keep the symlink spelling mapped too. Later target-level package maps can
  # otherwise reintroduce a canonical .cxx hash into DW_AT_comp_dir.
  "$<$<COMPILE_LANGUAGE:C,CXX,ASM>:-fdebug-compilation-dir=/build/${CMAKE_PROJECT_NAME}>"
)

# ThinLTO promotes local names using hashes of absolute source paths. Remove
# non-runtime symbols/debug info before LLD computes the genuine build ID.
# Production APKs already omit this metadata; development builds keep it.
add_link_options("-Wl,--strip-all")
