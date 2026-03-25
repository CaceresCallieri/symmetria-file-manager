qt_add_qml_module(yazifm-models
    URI YaziFM.Models
    VERSION ${PROJECT_VERSION}
    SOURCES
        filesystemmodel.hpp filesystemmodel.cpp
        previewimagehelper.hpp previewimagehelper.cpp
        syntaxhighlighthelper.hpp syntaxhighlighthelper.cpp
        archivepreviewmodel.hpp archivepreviewmodel.cpp
        spreadsheetpreviewmodel.hpp spreadsheetpreviewmodel.cpp
)

target_link_libraries(yazifm-models PRIVATE
    Qt::Core Qt::Qml Qt::Gui Qt::Concurrent
    KF6::SyntaxHighlighting
    PkgConfig::LibArchive
    QXlsx::QXlsx
    PkgConfig::FreeXL
)

# Install module to QML import path
qt_query_qml_module(yazifm-models
    PLUGIN_TARGET module_plugin_target
    TARGET_PATH module_target_path
    QMLDIR module_qmldir
    TYPEINFO module_typeinfo
)

set(module_dir "${INSTALL_QMLDIR}/${module_target_path}")
install(TARGETS yazifm-models LIBRARY DESTINATION "${module_dir}" RUNTIME DESTINATION "${module_dir}" COMPONENT runtime)
install(TARGETS "${module_plugin_target}" LIBRARY DESTINATION "${module_dir}" RUNTIME DESTINATION "${module_dir}" COMPONENT runtime)
install(FILES "${module_qmldir}" DESTINATION "${module_dir}" COMPONENT runtime)
install(FILES "${module_typeinfo}" DESTINATION "${module_dir}" COMPONENT dev)
