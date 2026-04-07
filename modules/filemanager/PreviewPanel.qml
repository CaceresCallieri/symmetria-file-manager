pragma ComponentBehavior: Bound

import "../../components"
import "../../services"
import "../../config"
import Symmetria.FileManager.Models
import QtQuick
import QtQuick.Layouts

Item {
    id: root

    required property var previewEntry  // FileSystemEntry | null
    property WindowState windowState

    // Flash navigation: directory entries exposed for cross-column search
    property var _directoryEntries: []
    readonly property var directoryEntries: _previewType === _typeDirectory ? _directoryEntries : []
    readonly property string directoryPath: (_previewType === _typeDirectory && _committedEntry) ? _committedEntry.path : ""

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
    readonly property int _typeAudio: 8
    readonly property int _typeRemoteDir: 9

    readonly property int _previewType: {
        if (!_committedEntry)
            return _typeNone;
        if (_committedEntry.isDir) {
            if (_committedEntry.isRemoteMount)
                return _typeRemoteDir;
            return _typeDirectory;
        }
        if (_committedEntry.isImage)
            return _typeImage;
        if (_committedEntry.isVideo)
            return _typeVideo;
        if (FileManagerService.isAudioFile(_committedEntry.mimeType))
            return _typeAudio;
        if (FileManagerService.isTextFile(_committedEntry.mimeType))
            return _typeText;
        if (FileManagerService.isArchiveFile(_committedEntry.mimeType))
            return _typeArchive;
        if (FileManagerService.isSpreadsheetFile(_committedEntry.mimeType))
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

    // Audio preview metadata
    readonly property string _audioDuration: audioLoader.item?.audioDuration ?? ""

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

                sourceComponent: PreviewStateIndicator {
                    iconName: "description"
                    message: qsTr("No preview")
                }
            }

            // Directory listing
            Loader {
                anchors.fill: parent
                active: _previewType === _typeDirectory
                asynchronous: true

                sourceComponent: Item {
                    // Empty folder indicator — only when not loading
                    Loader {
                        anchors.centerIn: parent
                        opacity: directoryView.count === 0 && !directoryView.model.loading ? 1 : 0
                        active: directoryView.count === 0 && !directoryView.model.loading

                        sourceComponent: PreviewStateIndicator {
                            iconName: "folder_open"
                            message: qsTr("Empty folder")
                        }

                        Behavior on opacity {
                            Anim {}
                        }
                    }

                    // Loading indicator — visible while directory is being scanned
                    Loader {
                        anchors.centerIn: parent
                        opacity: directoryView.model.loading ? 1 : 0
                        active: opacity > 0

                        sourceComponent: PreviewLoadingIndicator {}

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
                            sortBy: root.windowState ? root.windowState.sortBy : FileSystemModel.Modified
                            sortReverse: root.windowState ? root.windowState.sortReverse : true
                            watchChanges: false
                            onEntriesChanged: root._directoryEntries = entries
                        }

                        delegate: FileListItem {
                            width: directoryView.width
                            flashActive: root.windowState ? root.windowState.flashActive : false
                            flashQuery: root.windowState ? root.windowState.flashQuery : ""
                            flashLabel: root.windowState?.flashPreviewMatchMap[index]?.label ?? ""
                            flashMatchStart: root.windowState?.flashPreviewMatchMap[index]?.matchStart ?? -1
                        }
                    }
                }
            }

            // Remote directory — static indicator, no I/O
            Loader {
                anchors.centerIn: parent
                active: _previewType === _typeRemoteDir
                asynchronous: true

                sourceComponent: ColumnLayout {
                    spacing: Theme.spacing.md

                    MaterialIcon {
                        Layout.alignment: Qt.AlignHCenter
                        text: "lan"
                        color: Theme.palette.m3outline
                        font.pointSize: Theme.font.size.xxl * 2
                        font.weight: Font.Medium
                    }

                    StyledText {
                        Layout.alignment: Qt.AlignHCenter
                        text: qsTr("Remote directory")
                        color: Theme.palette.m3outline
                        font.pointSize: Theme.font.size.xl
                        font.weight: Font.Medium
                    }

                    StyledText {
                        Layout.alignment: Qt.AlignHCenter
                        text: qsTr("Press Enter to browse")
                        color: Theme.palette.m3outlineVariant
                        font.pointSize: Theme.font.size.sm
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

            // Audio preview (mp3, ogg, flac, wav, etc.)
            Loader {
                id: audioLoader

                anchors.fill: parent
                active: _previewType === _typeAudio
                asynchronous: true

                sourceComponent: AudioPreview {
                    entry: root._committedEntry
                    windowState: root.windowState
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
            audioDuration: root._audioDuration
        }
    }
}
