pragma ComponentBehavior: Bound

import Symmetria.FileManager.UI
import QtQuick
import QtWebEngine

// HtmlPreview — renders an .html/.xhtml file as an actual page via WebEngine,
// the "real browser" counterpart to TextPreview's highlighted source. Reached
// only when the user presses Ctrl+R on an HTML file (WindowState.htmlRenderActive)
// — never on plain navigation — so the heavyweight Chromium view spins up on
// explicit intent, not per j/k.
//
// SANDBOX (why this is safe to auto-render on a keystroke):
//   • javascriptEnabled  — OFF by default (Config.fileManager.htmlPreviewJavaScript).
//     Static pages render fine; JS-built pages render blank unless the user opts in.
//   • localContentCanAccessRemoteUrls: false — the local file CANNOT fetch ANY
//     remote resource (trackers, remote CSS/JS/img, beacons). It cannot phone home.
//   • off-the-record profile + NoCache — zero disk trace (no cookies/cache/history).
//   • LinkClickedNavigation is ignored — this stays a PREVIEW, not a mini-browser.
//
// HOST REQUIREMENT: instantiating a WebEngineView requires the host to have called
// QtWebEngineQuick::initialize() in main() before the QML engine loads (the
// standalone symmetria-fm host does). An embedding host that has NOT initialized
// WebEngine will fail to render here — importing the module is fine, only
// instantiation needs the init. See host/standalone/main.cpp.
Item {
    id: root

    required property var entry  // FileSystemEntry-shaped | null

    // file:// URL for the previewed path. encodeURI handles spaces; # and ? are
    // escaped explicitly so filenames containing them aren't parsed as URL
    // fragment/query. Empty string when there is no entry (WebEngine loads blank).
    readonly property url _fileUrl: entry
        ? "file://" + encodeURI(entry.path).replace(/#/g, "%23").replace(/\?/g, "%3F")
        : ""

    WebEngineView {
        id: webView

        anchors.fill: parent
        url: root._fileUrl
        // Faithful page background: browsers default to white for pages with no
        // background, so match that rather than let the dark FM backdrop bleed
        // through pages that assume white.
        backgroundColor: "white"

        // Off-the-record, cache-less profile — the preview leaves no trace.
        profile: WebEngineProfile {
            offTheRecord: true
            httpCacheType: WebEngineProfile.NoCache
        }

        settings.javascriptEnabled: Config.fileManager.htmlPreviewJavaScript
        settings.localContentCanAccessRemoteUrls: false  // no phoning home
        settings.localContentCanAccessFileUrls: true     // sibling css/img still load
        settings.javascriptCanOpenWindows: false
        settings.pluginsEnabled: false
        settings.screenCaptureEnabled: false
        settings.errorPageEnabled: false

        // Keep it a preview: allow only the initial local file load; ignore link
        // clicks, form submits, and any hop to another document.
        onNavigationRequested: function(request) {
            if (request.navigationType !== WebEngineNavigationRequest.TypedNavigation)
                request.action = WebEngineNavigationRequest.IgnoreRequest;
        }
    }

    // Loading indicator — while WebEngine fetches/lays out the page
    Loader {
        anchors.centerIn: parent
        active: webView.loading
        asynchronous: true
        sourceComponent: PreviewLoadingIndicator {}
    }

    // Error state — file gone, decode failure, etc.
    property bool _loadFailed: false
    Connections {
        target: webView
        function onLoadingChanged(loadRequest) {
            if (loadRequest.status === WebEngineView.LoadFailedStatus)
                root._loadFailed = true;
            else if (loadRequest.status === WebEngineView.LoadStartedStatus)
                root._loadFailed = false;
        }
    }

    Loader {
        anchors.centerIn: parent
        active: root._loadFailed
        asynchronous: true
        sourceComponent: PreviewStateIndicator {
            iconName: "block"
            message: qsTr("Cannot render")
        }
    }

    // Mode hint — tells the user they're in render mode and how to leave it.
    Rectangle {
        anchors.top: parent.top
        anchors.right: parent.right
        anchors.topMargin: FmTheme.padding.sm
        anchors.rightMargin: FmTheme.padding.sm
        width: hintRow.implicitWidth + FmTheme.padding.md * 2
        height: hintRow.implicitHeight + FmTheme.padding.sm * 2
        radius: FmTheme.rounding.sm
        color: Qt.rgba(0, 0, 0, 0.72)
        visible: !webView.loading && !root._loadFailed

        Row {
            id: hintRow
            anchors.centerIn: parent
            spacing: FmTheme.spacing.sm

            MaterialIcon {
                anchors.verticalCenter: parent.verticalCenter
                text: "html"
                color: "white"
                font.pointSize: FmTheme.font.size.xs
            }
            StyledText {
                anchors.verticalCenter: parent.verticalCenter
                text: qsTr("Rendered · Ctrl+R to exit")
                color: "white"
                font.pointSize: FmTheme.font.size.xs
            }
        }
    }
}
