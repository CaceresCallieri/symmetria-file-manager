#pragma once

#include <qhash.h>
#include <qset.h>
#include <qstring.h>
#include <qstringlist.h>

namespace symmetria::filemanager::models {

/// Resolves XDG icon names to SVG file paths from the active system icon theme.
/// Results are cached statically — each icon name is resolved at most once.
class IconThemeResolver {
public:
    /// Returns the absolute path to an SVG icon for the given icon name,
    /// or an empty string if not found in any theme in the inheritance chain.
    static QString resolve(const QString& iconName);

    /// Override the auto-detected theme. Clears the icon cache so subsequent
    /// resolve() calls use the new theme. Pass empty string to revert to auto-detection.
    static void setThemeOverride(const QString& themeName);

private:
    struct ThemeInfo {
        QString basePath;
        QStringList mimeDirs;   // e.g. {"mimes/scalable", "mimes/22", "mimes/16"}
        QStringList placesDirs; // e.g. {"places/scalable", "places/22", "places/16"}
        QStringList inherits;
    };

    static void ensureInitialised();
    static ThemeInfo parseTheme(const QString& themeName);
    static QString findIcon(const ThemeInfo& theme, const QString& iconName);
    static QString findIconRecursive(const QString& themeName, const QString& iconName,
                                     QSet<QString>& visited);
    static QString locateThemeDir(const QString& themeName);

    static inline QHash<QString, QString> s_cache;
    static inline QHash<QString, ThemeInfo> s_themes;
    static inline QString s_activeTheme;
    static inline bool s_initialised = false;
};

} // namespace symmetria::filemanager::models
