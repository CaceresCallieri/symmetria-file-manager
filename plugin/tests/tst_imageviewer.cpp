// Qt Quick Test entry point for the ImageViewer.js (in-app image viewer
// folder-navigation helpers) tests. Assertions live in tst_imageviewer.qml,
// loaded via the -input argument set in CMakeLists.txt. Qt Quick Test needs a
// QGuiApplication, so the test runs under QT_QPA_PLATFORM=offscreen in CI.
#include <QtQuickTest/quicktest.h>

QUICK_TEST_MAIN(imageviewer)
