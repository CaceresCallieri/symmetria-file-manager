import "../../components"
import "../../services"
import "../../config"
import Symmetria.Models
import QtQuick
import QtQuick.Layouts

Item {
    id: root

    required property var previewEntry  // FileSystemEntry | null

    // --- Internal state ---

    // Debounced entry — only updated after user settles on a file
    property var _committedEntry: null

    // Preview type constants
    readonly property int _typeNone: 0
    readonly property int _typeDirectory: 1
    readonly property int _typeImage: 2
    readonly property int _typeFallback: 3

    readonly property int _previewType: {
        if (!_committedEntry)
            return _typeNone;
        if (_committedEntry.isDir)
            return _typeDirectory;
        if (_committedEntry.isImage)
            return _typeImage;
        return _typeFallback;
    }

    readonly property bool _showNone: _previewType === _typeNone
    readonly property bool _showDirectory: _previewType === _typeDirectory
    readonly property bool _showImage: _previewType === _typeImage
    readonly property bool _showFallback: _previewType === _typeFallback

    // Image natural dimensions — declarative binding so it updates reactively
    // as the Image decodes (implicitWidth/Height change on Image.Ready)
    readonly property size _imageNaturalSize: imageLoader.item
        ? imageLoader.item.naturalSize
        : Qt.size(0, 0)

    // --- Debounce ---

    onPreviewEntryChanged: {
        if (previewEntry === null) {
            // Instant clear — "No preview" should appear without delay
            _previewDebounce.stop();
            _committedEntry = null;
        } else {
            _previewDebounce.restart();
        }
    }

    Timer {
        id: _previewDebounce
        interval: 150
        onTriggered: root._committedEntry = root.previewEntry
    }

    // --- Background ---

    StyledRect {
        anchors.fill: parent
        color: Theme.layer(Theme.palette.m3surfaceContainerLow, 1)
    }

    // --- Layout: preview area + metadata strip ---

    ColumnLayout {
        anchors.fill: parent
        spacing: 0

        // Preview area — all Loaders stack here, only one active at a time
        Item {
            Layout.fillWidth: true
            Layout.fillHeight: true

            // Empty / no-selection state
            Loader {
                anchors.centerIn: parent
                active: root._showNone
                asynchronous: true

                sourceComponent: ColumnLayout {
                    spacing: Theme.spacing.normal

                    MaterialIcon {
                        Layout.alignment: Qt.AlignHCenter
                        text: "description"
                        color: Theme.palette.m3outline
                        font.pointSize: Theme.font.size.extraLarge * 2
                        font.weight: 500
                    }

                    StyledText {
                        Layout.alignment: Qt.AlignHCenter
                        text: qsTr("No preview")
                        color: Theme.palette.m3outline
                        font.pointSize: Theme.font.size.large
                        font.weight: 500
                    }
                }
            }

            // Directory listing
            Loader {
                anchors.fill: parent
                active: root._showDirectory
                asynchronous: true

                sourceComponent: Item {
                    // Empty folder indicator
                    Loader {
                        anchors.centerIn: parent
                        opacity: directoryView.count === 0 ? 1 : 0
                        active: directoryView.count === 0

                        sourceComponent: ColumnLayout {
                            spacing: Theme.spacing.normal

                            MaterialIcon {
                                Layout.alignment: Qt.AlignHCenter
                                text: "folder_open"
                                color: Theme.palette.m3outline
                                font.pointSize: Theme.font.size.extraLarge * 2
                                font.weight: 500
                            }

                            StyledText {
                                Layout.alignment: Qt.AlignHCenter
                                text: qsTr("Empty folder")
                                color: Theme.palette.m3outline
                                font.pointSize: Theme.font.size.large
                                font.weight: 500
                            }
                        }

                        Behavior on opacity {
                            Anim {}
                        }
                    }

                    ListView {
                        id: directoryView

                        anchors.fill: parent
                        anchors.margins: Theme.padding.small
                        clip: true
                        focus: false
                        interactive: false
                        keyNavigationEnabled: false
                        currentIndex: -1
                        boundsBehavior: Flickable.StopAtBounds

                        model: FileSystemModel {
                            path: root._committedEntry?.path ?? ""
                            showHidden: Config.fileManager.showHidden
                            sortReverse: Config.fileManager.sortReverse
                            watchChanges: false
                        }

                        delegate: FileListItem {
                            width: directoryView.width
                        }
                    }
                }
            }

            // Image preview
            Loader {
                id: imageLoader

                anchors.fill: parent
                active: root._showImage
                asynchronous: true

                sourceComponent: ImagePreview {
                    entry: root._committedEntry
                }
            }

            // Fallback preview (non-image, non-directory files)
            Loader {
                anchors.fill: parent
                active: root._showFallback
                asynchronous: true

                sourceComponent: FallbackPreview {
                    entry: root._committedEntry
                }
            }
        }

        // Metadata strip at the bottom
        PreviewMetadata {
            Layout.fillWidth: true
            entry: root._committedEntry
            imageSize: root._imageNaturalSize
        }
    }
}
