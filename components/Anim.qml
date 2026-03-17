import "../services"
import QtQuick

NumberAnimation {
    duration: Theme.animDuration
    easing.type: Easing.BezierSpline
    easing.bezierCurve: Theme.animCurveStandard
}
