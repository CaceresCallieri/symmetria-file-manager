#pragma once

#include <qabstractitemmodel.h>
#include <qdatetime.h>
#include <qdir.h>
#include <qfilesystemwatcher.h>
#include <qfuture.h>
#include <qimagereader.h>
#include <qmimedatabase.h>
#include <qobject.h>
#include <qcollator.h>
#include <qqmlintegration.h>
#include <qqmllist.h>

namespace symmetria::filemanager::models {

// Pre-computed file metadata built in the background thread so that
// FileSystemEntry construction on the main thread avoids blocking stat() calls
// (critical for SSHFS/FUSE mounts where stat is a network round-trip).
struct CachedEntryData {
    QString path;
    QString relativePath;
    QFileInfo fileInfo;
    QString permissions;
    QString owner;
    bool isRemoteMount = false;
    // Pre-computed in background thread to avoid GUI-thread I/O
    bool isImage = false;
    bool isVideo = false;
    QString mimeType;
};

class FileSystemEntry : public QObject {
    Q_OBJECT
    QML_ELEMENT
    QML_UNCREATABLE("FileSystemEntry instances can only be retrieved from a FileSystemModel")

    Q_PROPERTY(QString path READ path CONSTANT)
    Q_PROPERTY(QString relativePath READ relativePath NOTIFY relativePathChanged)
    Q_PROPERTY(QString name READ name CONSTANT)
    Q_PROPERTY(QString baseName READ baseName CONSTANT)
    Q_PROPERTY(QString parentDir READ parentDir CONSTANT)
    Q_PROPERTY(QString suffix READ suffix CONSTANT)
    Q_PROPERTY(qint64 size READ size CONSTANT)
    Q_PROPERTY(bool isDir READ isDir CONSTANT)
    Q_PROPERTY(bool isImage READ isImage CONSTANT)
    Q_PROPERTY(bool isVideo READ isVideo CONSTANT)
    Q_PROPERTY(bool isSymlink READ isSymlink CONSTANT)
    Q_PROPERTY(bool isExecutable READ isExecutable CONSTANT)
    Q_PROPERTY(QDateTime modifiedDate READ modifiedDate CONSTANT)
    Q_PROPERTY(QString permissions READ permissions CONSTANT)
    Q_PROPERTY(QString symlinkTarget READ symlinkTarget CONSTANT)
    Q_PROPERTY(QString owner READ owner CONSTANT)
    Q_PROPERTY(QString mimeType READ mimeType CONSTANT)
    Q_PROPERTY(QString iconPath READ iconPath CONSTANT)
    Q_PROPERTY(bool isRemoteMount READ isRemoteMount CONSTANT)

public:
    explicit FileSystemEntry(const QString& path, const QString& relativePath, QObject* parent = nullptr);
    explicit FileSystemEntry(CachedEntryData&& data, QObject* parent = nullptr);

    [[nodiscard]] QString path() const;
    [[nodiscard]] QString relativePath() const;
    [[nodiscard]] QString name() const;
    [[nodiscard]] QString baseName() const;
    [[nodiscard]] QString parentDir() const;
    [[nodiscard]] QString suffix() const;
    [[nodiscard]] qint64 size() const;
    [[nodiscard]] bool isDir() const;
    [[nodiscard]] bool isImage() const;
    [[nodiscard]] bool isVideo() const;
    [[nodiscard]] bool isSymlink() const;
    [[nodiscard]] bool isExecutable() const;
    [[nodiscard]] QDateTime modifiedDate() const;
    [[nodiscard]] QString permissions() const;
    [[nodiscard]] QString symlinkTarget() const;
    [[nodiscard]] QString owner() const;
    [[nodiscard]] QString mimeType() const;
    [[nodiscard]] QString iconPath() const;
    [[nodiscard]] bool isRemoteMount() const;

    void updateRelativePath(const QDir& dir);

signals:
    void relativePathChanged();

private:
    const QFileInfo m_fileInfo;

    const QString m_path;
    QString m_relativePath;

    const bool m_isImage;
    const QString m_mimeType;    // Must precede m_isVideo and m_iconPath (init-order dependency)
    const bool m_isVideo;
    const QString m_iconPath;

    const QString m_permissions; // Pre-computed Unix-style permission string (e.g. drwxr-xr-x)
    const QString m_owner;       // Pre-computed at construction; owner() is a blocking syscall
    const bool m_isRemoteMount;  // True if path is an SSHFS/FUSE/NFS mount point
};

class FileSystemModel : public QAbstractListModel {
    Q_OBJECT
    QML_ELEMENT

    Q_PROPERTY(QString path READ path WRITE setPath NOTIFY pathChanged)
    Q_PROPERTY(bool recursive READ recursive WRITE setRecursive NOTIFY recursiveChanged)
    Q_PROPERTY(bool watchChanges READ watchChanges WRITE setWatchChanges NOTIFY watchChangesChanged)
    Q_PROPERTY(bool showHidden READ showHidden WRITE setShowHidden NOTIFY showHiddenChanged)
    Q_PROPERTY(bool sortReverse READ sortReverse WRITE setSortReverse NOTIFY sortReverseChanged)
    Q_PROPERTY(SortBy sortBy READ sortBy WRITE setSortBy NOTIFY sortByChanged)
    Q_PROPERTY(Filter filter READ filter WRITE setFilter NOTIFY filterChanged)
    Q_PROPERTY(QStringList nameFilters READ nameFilters WRITE setNameFilters NOTIFY nameFiltersChanged)

    Q_PROPERTY(QQmlListProperty<symmetria::filemanager::models::FileSystemEntry> entries READ entries NOTIFY entriesChanged)
    Q_PROPERTY(bool loading READ loading NOTIFY loadingChanged)

public:
    enum SortBy {
        Alphabetical,
        Modified,
        Size,
        Extension,
        Natural
    };
    Q_ENUM(SortBy)

    enum Filter {
        NoFilter,
        Images,
        Files,
        Dirs
    };
    Q_ENUM(Filter)

    explicit FileSystemModel(QObject* parent = nullptr);

    int rowCount(const QModelIndex& parent = QModelIndex()) const override;
    QVariant data(const QModelIndex& index, int role = Qt::DisplayRole) const override;
    QHash<int, QByteArray> roleNames() const override;

    [[nodiscard]] QString path() const;
    void setPath(const QString& path);

    [[nodiscard]] bool recursive() const;
    void setRecursive(bool recursive);

    [[nodiscard]] bool watchChanges() const;
    void setWatchChanges(bool watchChanges);

    [[nodiscard]] bool showHidden() const;
    void setShowHidden(bool showHidden);

    [[nodiscard]] bool sortReverse() const;
    void setSortReverse(bool sortReverse);

    [[nodiscard]] SortBy sortBy() const;
    void setSortBy(SortBy sortBy);

    [[nodiscard]] Filter filter() const;
    void setFilter(Filter filter);

    [[nodiscard]] QStringList nameFilters() const;
    void setNameFilters(const QStringList& nameFilters);

    [[nodiscard]] QQmlListProperty<FileSystemEntry> entries();
    [[nodiscard]] bool loading() const;

signals:
    void pathChanged();
    void recursiveChanged();
    void watchChangesChanged();
    void showHiddenChanged();
    void sortReverseChanged();
    void sortByChanged();
    void filterChanged();
    void nameFiltersChanged();
    void entriesChanged();
    void loadingChanged();

private:
    QDir m_dir;
    QFileSystemWatcher m_watcher;
    QList<FileSystemEntry*> m_entries;
    QHash<QString, QFuture<QPair<QSet<QString>, QList<CachedEntryData>>>> m_futures;

    QString m_path;
    bool m_recursive;
    bool m_watchChanges;
    bool m_showHidden;
    bool m_sortReverse;
    SortBy m_sortBy;
    Filter m_filter;
    QStringList m_nameFilters;
    bool m_loading = false;

    void watchDirIfRecursive(const QString& path);
    void resort();
    void update();
    void updateWatcher();
    void updateEntries();
    void updateEntriesForDir(const QString& dir);
    void applyChanges(const QSet<QString>& removedPaths, QList<CachedEntryData> addedEntries);
    [[nodiscard]] bool compareEntries(const FileSystemEntry* a, const FileSystemEntry* b) const;
};

} // namespace symmetria::filemanager::models
