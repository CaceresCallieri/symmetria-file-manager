cmake_minimum_required(VERSION 3.19)
project(yazifm-plugin VERSION 0.1.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)
set(CMAKE_INSTALL_PREFIX "/" CACHE STRING "Install prefix")

set(INSTALL_QMLDIR "usr/lib/qt6/qml" CACHE STRING "QML module install directory")

find_package(Qt6 REQUIRED COMPONENTS Core Qml Gui Concurrent)
# QXlsx links against Qt6::GuiPrivate
find_package(Qt6 REQUIRED COMPONENTS GuiPrivate)
find_package(KF6SyntaxHighlighting REQUIRED)
find_package(PkgConfig REQUIRED)
pkg_check_modules(LibArchive IMPORTED_TARGET libarchive REQUIRED)
find_package(QXlsxQt6 REQUIRED)
pkg_check_modules(FreeXL IMPORTED_TARGET freexl REQUIRED)

set(QT_QML_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/qml")
qt_standard_project_setup(REQUIRES 6.9)

add_compile_options(
    -Wall -Wextra -Wpedantic -Wshadow -Wconversion
    -Wold-style-cast -Wnull-dereference -Wdouble-promotion
    -Wformat=2 -Wfloat-equal -Woverloaded-virtual
    -Wsign-conversion -Wredundant-decls -Wswitch
    -Wunreachable-code
)

if(CMAKE_CXX_COMPILER_ID MATCHES "Clang")
    add_compile_options(-Wunused-lambda-capture)
endif()

add_subdirectory(src/YaziFM/Models)

# Clear Quickshell QML cache after install
install(CODE "
    if(DEFINED ENV{SUDO_USER})
        set(_user_home \"/home/\$ENV{SUDO_USER}\")
    else()
        set(_user_home \"\$ENV{HOME}\")
    endif()
    set(_qmlcache_dir \"\${_user_home}/.cache/quickshell/qmlcache\")
    if(EXISTS \"\${_qmlcache_dir}\")
        message(STATUS \"Clearing Quickshell QML cache: \${_qmlcache_dir}\")
        file(REMOVE_RECURSE \"\${_qmlcache_dir}\")
    endif()
")
