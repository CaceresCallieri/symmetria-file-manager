import "../../components"
import "../../services"
import Symmetria.FileManager.Models
import QtQuick
import QtQuick.Layouts
import QtMultimedia

Item {
    id: root

    required property var entry
    property WindowState windowState

    // Exposed for PreviewMetadata
    readonly property string audioTitle: {
        const _dep = mediaPlayer.mediaStatus;
        return mediaPlayer.metaData.value(MediaMetaData.Title) ?? "";
    }
    readonly property string audioArtist: {
        const _dep = mediaPlayer.mediaStatus;
        return mediaPlayer.metaData.value(MediaMetaData.ContributingArtist) ?? "";
    }
    readonly property string audioDuration: {
        const dur = mediaPlayer.duration > 0 ? mediaPlayer.duration : waveformModel.duration;
        if (dur <= 0) return "";
        const totalSeconds = Math.floor(dur / 1000);
        const minutes = Math.floor(totalSeconds / 60);
        const seconds = totalSeconds % 60;
        return minutes + ":" + (seconds < 10 ? "0" : "") + seconds;
    }
    readonly property bool isPlaying: mediaPlayer.playbackState === MediaPlayer.PlayingState

    // Listen for play/pause toggle from context menu
    Connections {
        target: root.windowState
        function onAudioPlaybackToggle() {
            if (mediaPlayer.playbackState === MediaPlayer.PlayingState)
                mediaPlayer.pause();
            else
                mediaPlayer.play();
        }
    }

    // --- Audio engine ---

    MediaPlayer {
        id: mediaPlayer
        source: root.entry ? encodeURI("file://" + root.entry.path) : ""
        audioOutput: AudioOutput {}
        autoPlay: false
    }

    // --- Waveform data ---

    AudioWaveformModel {
        id: waveformModel
        filePath: root.entry ? root.entry.path : ""
    }

    // --- Repaint throttle for waveform during playback ---

    Timer {
        id: repaintTimer
        interval: 50
        repeat: true
        running: root.isPlaying
        onTriggered: waveformCanvas.requestPaint()
    }

    // --- Layout: vertically centered group ---

    ColumnLayout {
        anchors.left: parent.left
        anchors.right: parent.right
        anchors.verticalCenter: parent.verticalCenter
        anchors.margins: Theme.padding.lg
        spacing: Theme.spacing.md

        // Album art or fallback icon
        Item {
            Layout.fillWidth: true
            Layout.preferredHeight: 100
            Layout.maximumHeight: 100

            // Album art from metadata
            Image {
                id: albumArt

                readonly property var thumbnail: {
                    const _dep = mediaPlayer.mediaStatus;
                    return mediaPlayer.metaData.value(MediaMetaData.ThumbnailImage) ?? null;
                }

                anchors.centerIn: parent
                width: Math.min(parent.width, parent.height)
                height: width
                visible: status === Image.Ready
                fillMode: Image.PreserveAspectFit
                source: thumbnail ? thumbnail : ""
                sourceSize: Qt.size(100, 100)
            }

            // Fallback icon when no album art
            MaterialIcon {
                anchors.centerIn: parent
                visible: albumArt.status !== Image.Ready
                text: "music_note"
                color: Theme.palette.m3outline
                font.pointSize: Theme.font.size.xxl * 1.5
                font.weight: 500

                opacity: waveformModel.loading ? 0.4 : 0.7

                Behavior on opacity {
                    Anim {}
                }
            }
        }

        // Metadata: title and artist
        ColumnLayout {
            Layout.fillWidth: true
            spacing: 2
            visible: root.audioTitle !== "" || root.audioArtist !== ""

            StyledText {
                Layout.fillWidth: true
                visible: root.audioTitle !== ""
                text: root.audioTitle
                color: Theme.palette.m3onSurface
                font.pointSize: Theme.font.size.md
                font.weight: 600
                elide: Text.ElideRight
                horizontalAlignment: Text.AlignHCenter
            }

            StyledText {
                Layout.fillWidth: true
                visible: root.audioArtist !== ""
                text: root.audioArtist
                color: Theme.palette.m3onSurfaceVariant
                font.pointSize: Theme.font.size.sm
                elide: Text.ElideRight
                horizontalAlignment: Text.AlignHCenter
            }
        }

        // Waveform canvas — fixed height, no stretch
        Item {
            Layout.fillWidth: true
            Layout.preferredHeight: 80

            Canvas {
                id: waveformCanvas

                anchors.fill: parent

                readonly property var peaks: waveformModel.peaks
                readonly property real progress: mediaPlayer.duration > 0
                    ? mediaPlayer.position / mediaPlayer.duration
                    : 0

                onPeaksChanged: requestPaint()

                onPaint: {
                    const ctx = getContext("2d");
                    ctx.clearRect(0, 0, width, height);

                    const peakData = peaks;
                    if (!peakData || peakData.length === 0) return;

                    const barWidth = 2;
                    const gap = 1;
                    const step = barWidth + gap;
                    const barCount = Math.floor(width / step);
                    const centerY = height / 2;
                    const maxBarHeight = centerY - 2; // 2px padding from edges

                    const playedColor = String(Theme.palette.m3primary);
                    const unplayedColor = Qt.alpha(Theme.palette.m3onSurface, 0.15);
                    const progressBarIndex = Math.floor(progress * barCount);

                    for (let i = 0; i < barCount; i++) {
                        // Map bar index to peak data via nearest-neighbor
                        const peakIndex = Math.floor(i * peakData.length / barCount);
                        const peak = peakData[Math.min(peakIndex, peakData.length - 1)] ?? 0;

                        // Minimum bar height for visual consistency
                        const barHeight = Math.max(1, peak * maxBarHeight);
                        const x = i * step;

                        ctx.fillStyle = i < progressBarIndex ? playedColor : unplayedColor;

                        // Draw mirrored bars (top and bottom from center)
                        ctx.fillRect(x, centerY - barHeight, barWidth, barHeight);
                        ctx.fillRect(x, centerY, barWidth, barHeight);
                    }
                }

                // Click to seek
                MouseArea {
                    anchors.fill: parent
                    onClicked: function(mouse) {
                        if (mediaPlayer.duration > 0 && mediaPlayer.seekable) {
                            const seekPos = (mouse.x / width) * mediaPlayer.duration;
                            mediaPlayer.position = Math.floor(seekPos);

                            // Start playing if not already
                            if (mediaPlayer.playbackState !== MediaPlayer.PlayingState)
                                mediaPlayer.play();
                        }
                    }
                }
            }

            // Loading overlay for waveform
            StyledText {
                anchors.centerIn: parent
                visible: waveformModel.loading && waveformModel.peaks.length === 0
                text: qsTr("Loading waveform\u2026")
                color: Theme.palette.m3outline
                font.pointSize: Theme.font.size.sm
            }
        }

        // Time display and play state — tight with waveform
        RowLayout {
            Layout.fillWidth: true
            spacing: Theme.spacing.sm

            // Current position
            StyledText {
                readonly property int posSeconds: Math.floor(mediaPlayer.position / 1000)
                text: Math.floor(posSeconds / 60) + ":" + (posSeconds % 60 < 10 ? "0" : "") + (posSeconds % 60)
                color: Theme.palette.m3onSurfaceVariant
                font.pointSize: Theme.font.size.xs
                font.family: Theme.font.family.mono
            }

            Item { Layout.fillWidth: true }

            // Play state indicator
            MaterialIcon {
                text: root.isPlaying ? "pause" : "play_arrow"
                color: root.isPlaying ? Theme.palette.m3primary : Theme.palette.m3outline
                font.pointSize: Theme.font.size.md

                Behavior on color {
                    CAnim {}
                }
            }

            Item { Layout.fillWidth: true }

            // Total duration
            StyledText {
                text: root.audioDuration !== "" ? root.audioDuration : "--:--"
                color: Theme.palette.m3onSurfaceVariant
                font.pointSize: Theme.font.size.xs
                font.family: Theme.font.family.mono
            }
        }

        // Play hint
        StyledText {
            Layout.alignment: Qt.AlignHCenter
            visible: !root.isPlaying && mediaPlayer.playbackState === MediaPlayer.StoppedState
            text: qsTr("Ctrl+P \u2192 Play / Pause")
            color: Qt.alpha(Theme.palette.m3outline, 0.6)
            font.pointSize: Theme.font.size.xs
        }
    }

    // --- Error state ---

    Loader {
        anchors.centerIn: parent
        active: mediaPlayer.error !== MediaPlayer.NoError
        asynchronous: true

        sourceComponent: ColumnLayout {
            spacing: Theme.spacing.md

            MaterialIcon {
                Layout.alignment: Qt.AlignHCenter
                text: "music_off"
                color: Theme.palette.m3outline
                font.pointSize: Theme.font.size.xxl * 2
                font.weight: 500
            }

            StyledText {
                Layout.alignment: Qt.AlignHCenter
                text: qsTr("Cannot preview")
                color: Theme.palette.m3outline
                font.pointSize: Theme.font.size.xl
                font.weight: 500
            }
        }
    }
}
