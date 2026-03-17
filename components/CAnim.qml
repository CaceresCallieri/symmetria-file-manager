import "../services"
import QtQuick

ColorAnimation {
    duration: Theme.animDuration
    easing.type: Easing.BezierSpline
    easing.bezierCurve: Theme.animCurveStandard
}
