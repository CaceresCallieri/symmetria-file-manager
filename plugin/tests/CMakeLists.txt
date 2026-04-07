find_package(Qt6 REQUIRED COMPONENTS Test Core Concurrent Gui Qml)
find_package(KF6SyntaxHighlighting REQUIRED)
find_package(PkgConfig REQUIRED)
pkg_check_modules(LibArchive IMPORTED_TARGET libarchive REQUIRED)

set(MODELS_SRC_DIR "${CMAKE_CURRENT_SOURCE_DIR}/../src/Symmetria/FileManager/Models")

function(add_model_test TEST_NAME)
    add_executable(${TEST_NAME} ${TEST_NAME}.cpp)
    target_include_directories(${TEST_NAME} PRIVATE ${MODELS_SRC_DIR})
    target_link_libraries(${TEST_NAME} PRIVATE
        Qt6::Test
        Qt6::Core
        Qt6::Gui
        Qt6::Qml
        symmetria-filemanager-models
    )
    add_test(NAME ${TEST_NAME} COMMAND ${TEST_NAME})
    # QTextDocument and QImageReader require QGuiApplication; offscreen avoids
    # needing a display server in CI or headless environments.
    set_tests_properties(${TEST_NAME} PROPERTIES
        ENVIRONMENT "QT_QPA_PLATFORM=offscreen"
    )
endfunction()

add_model_test(FileSystemModelTest)
target_link_libraries(FileSystemModelTest PRIVATE Qt6::Concurrent)

add_model_test(ArchivePreviewModelTest)
target_link_libraries(ArchivePreviewModelTest PRIVATE PkgConfig::LibArchive)

add_model_test(SyntaxHighlightHelperTest)
target_link_libraries(SyntaxHighlightHelperTest PRIVATE KF6::SyntaxHighlighting)
