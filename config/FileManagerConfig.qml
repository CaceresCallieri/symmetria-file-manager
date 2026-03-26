import QtQuick

QtObject {
    property bool showHidden: true
    property string iconMode: "system" // "material" | "system"
    property Sizes sizes: Sizes {}

    component Sizes: QtObject {
        property int windowWidth: 820
        property int windowHeight: 520
        property int itemHeight: 20
    }
}
