import "../../components"
import "../../services"
import "../../config"
import YaziFM.Models
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
    readonly property int _typeArchive: 6
    readonly property int _typeSpreadsheet: 7

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

    function _isArchiveFile(entry) {
        if (!entry) return false;
        const mime = entry.mimeType;
        return [
            // Standard archives
            "application/zip",
            "application/x-tar",
            "application/x-7z-compressed",
            "application/x-rar", "application/x-rar-compressed", "application/vnd.rar",
            "application/x-cpio",
            "application/vnd.ms-cab-compressed",
            "application/x-xar",
            // Compressed tars
            "application/x-compressed-tar",
            "application/x-bzip-compressed-tar",
            "application/x-xz-compressed-tar",
            "application/x-zstd-compressed-tar",
            "application/x-lzma-compressed-tar",
            // Standalone compression (may contain tar inside)
            "application/gzip", "application/x-gzip",
            "application/x-bzip2",
            "application/x-xz",
            "application/zstd", "application/x-zstd",
            // Disc/package formats
            "application/x-iso9660-image",
            "application/x-debian-package",
            // Zip-based formats
            "application/java-archive",
            "application/epub+zip",
        ].includes(mime);
    }

    function _isSpreadsheetFile(entry) {
        if (!entry) return false;
        const mime = entry.mimeType;
        return [
            "application/vnd.ms-excel",                                              // .xls
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",     // .xlsx
            "application/vnd.openxmlformats-officedocument.spreadsheetml.template",  // .xltx
            "application/vnd.ms-excel.sheet.macroEnabled.12",                        // .xlsm
            "application/vnd.ms-excel.template.macroEnabled.12",                     // .xltm
            "application/vnd.ms-excel.sheet.binary.macroEnabled.12",                 // .xlsb
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
        if (_isArchiveFile(_committedEntry))
            return _typeArchive;
        if (_isSpreadsheetFile(_committedEntry))
            return _typeSpreadsheet;
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

    // Archive preview metadata — file and directory counts
    readonly property int _archiveFileCount: archiveLoader.item?.fileCount ?? 0
    readonly property int _archiveDirCount: archiveLoader.item?.dirCount ?? 0

    // Spreadsheet preview metadata — sheet info and dimensions
    readonly property int _spreadsheetSheetCount: spreadsheetLoader.item?.sheetCount ?? 0
    readonly property int _spreadsheetActiveSheet: spreadsheetLoader.item?.activeSheet ?? 0
    readonly property int _spreadsheetTotalRows: spreadsheetLoader.item?.totalRows ?? 0
    readonly property int _spreadsheetTotalCols: spreadsheetLoader.item?.totalCols ?? 0

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
                    spacing: Theme.spacing.md

                    MaterialIcon {
                        Layout.alignment: Qt.AlignHCenter
                        text: "description"
                        color: Theme.palette.m3outline
                        font.pointSize: Theme.font.size.xxl * 2
                        font.weight: 500
                    }

                    StyledText {
                        Layout.alignment: Qt.AlignHCenter
                        text: qsTr("No preview")
                        color: Theme.palette.m3outline
                        font.pointSize: Theme.font.size.xl
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
                            spacing: Theme.spacing.md

                            MaterialIcon {
                                Layout.alignment: Qt.AlignHCenter
                                text: "folder_open"
                                color: Theme.palette.m3outline
                                font.pointSize: Theme.font.size.xxl * 2
                                font.weight: 500
                            }

                            StyledText {
                                Layout.alignment: Qt.AlignHCenter
                                text: qsTr("Empty folder")
                                color: Theme.palette.m3outline
                                font.pointSize: Theme.font.size.xl
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
                        anchors.margins: Theme.padding.sm
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

            // Archive preview (zip, tar, 7z, rar, deb, iso, etc.)
            Loader {
                id: archiveLoader

                anchors.fill: parent
                active: _previewType === _typeArchive
                asynchronous: true

                sourceComponent: ArchivePreview {
                    entry: root._committedEntry
                }
            }

            // Spreadsheet preview (.xls, .xlsx)
            Loader {
                id: spreadsheetLoader

                anchors.fill: parent
                active: _previewType === _typeSpreadsheet
                asynchronous: true

                sourceComponent: SpreadsheetPreview {
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
            archiveFileCount: root._archiveFileCount
            archiveDirCount: root._archiveDirCount
            spreadsheetSheetCount: root._spreadsheetSheetCount
            spreadsheetActiveSheet: root._spreadsheetActiveSheet
            spreadsheetTotalRows: root._spreadsheetTotalRows
            spreadsheetTotalCols: root._spreadsheetTotalCols
        }
    }
}
