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
    readonly property int _typeVideo: 3
    readonly property int _typeText: 4
    readonly property int _typeFallback: 5

    function _isTextFile(entry) {
        if (!entry) return false;
        const mime = entry.mimeType;
        if (mime.startsWith("text/")) return true;
        // application/* types that are actually text-based
        return [
            "application/json", "application/xml",
            "application/x-shellscript", "application/x-yaml",
            "application/toml", "application/javascript",
            "application/typescript", "application/x-perl",
            "application/x-ruby", "application/x-httpd-php",
            "application/sql", "application/x-desktop",
            "application/xhtml+xml",
        ].includes(mime);
    }

    readonly property int _previewType: {
        if (!_committedEntry)
            return _typeNone;
        if (_committedEntry.isDir)
            return _typeDirectory;
        if (_committedEntry.isImage)
            return _typeImage;
        if (_committedEntry.isVideo)
            return _typeVideo;
        if (_isTextFile(_committedEntry))
            return _typeText;
        return _typeFallback;
    }

    // Media natural dimensions — declarative bindings so they update reactively
    readonly property size _imageNaturalSize: imageLoader.item
        ? imageLoader.item.naturalSize
        : Qt.size(0, 0)

    readonly property size _videoNaturalSize: videoLoader.item
        ? videoLoader.item.naturalSize
        : Qt.size(0, 0)

    // Unified media dimensions for the metadata strip — image or video, zero otherwise
    readonly property size _mediaNaturalSize: _previewType === _typeImage
        ? _imageNaturalSize
        : _previewType === _typeVideo
            ? _videoNaturalSize
            : Qt.size(0, 0)

    // Text preview metadata — language name and line count
    readonly property int _textLineCount: textLoader.item?.lineCount ?? 0
    readonly property string _textLanguage: textLoader.item?.language ?? ""

    // --- Debounce ---

    onPreviewEntryChanged: {
        if (!previewEntry) {
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
                active: _previewType === _typeNone
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
                active: _previewType === _typeDirectory
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
                active: _previewType === _typeImage
                asynchronous: true

                sourceComponent: ImagePreview {
                    entry: root._committedEntry
                }
            }

            // Video preview
            Loader {
                id: videoLoader

                anchors.fill: parent
                active: _previewType === _typeVideo
                asynchronous: true

                sourceComponent: VideoPreview {
                    entry: root._committedEntry
                }
            }

            // Text preview (source code, config files, etc.)
            Loader {
                id: textLoader

                anchors.fill: parent
                active: _previewType === _typeText
                asynchronous: true

                sourceComponent: TextPreview {
                    entry: root._committedEntry
                }
            }

            // Fallback preview (non-image, non-directory, non-video, non-text files)
            Loader {
                anchors.fill: parent
                active: _previewType === _typeFallback
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
            imageDimensions: root._mediaNaturalSize
            textLanguage: root._textLanguage
            textLineCount: root._textLineCount
        }
    }
}
