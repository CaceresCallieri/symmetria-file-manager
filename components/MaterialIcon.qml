import "../services"

StyledText {
    property real fill
    property int grade: Theme.light ? 0 : -25

    font.family: Theme.font.family.material
    font.pointSize: Theme.font.size.larger
    font.variableAxes: ({
            FILL: fill.toFixed(1),
            GRAD: grade,
            opsz: fontInfo.pixelSize,
            wght: fontInfo.weight
        })
}
