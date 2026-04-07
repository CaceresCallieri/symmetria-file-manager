#include "filesystemmodel.hpp"
#include "iconthemeresolver.hpp"

#include <qdiriterator.h>
#include <qfuturewatcher.h>
#include <qtconcurrentrun.h>
#include <sys/vfs.h>

#ifndef FUSE_SUPER_MAGIC
#define FUSE_SUPER_MAGIC 0x65735546
#endif
#ifndef NFS_SUPER_MAGIC
#define NFS_SUPER_MAGIC 0x6969
#endif
#ifndef SMB_SUPER_MAGIC
#define SMB_SUPER_MAGIC 0x517B
#endif
#ifndef CIFS_SUPER_MAGIC
#define CIFS_SUPER_MAGIC 0xFF534D42
#endif

namespace symmetria::filemanager::models {

// Forward declaration — defined after the accessors to keep related code together.
static QString buildPermissions(const QFileInfo& info);

// Resolves the XDG icon path from a pre-computed MIME type string.
// Runs on the main thread (IconThemeResolver uses unsynchronized static caches)
// but is cheap: no remote I/O, results cached after first lookup per icon name.
static QString resolveIconPath(const QFileInfo& fileInfo, const QString& mimeType) {
    if (fileInfo.isDir())
        return IconThemeResolver::resolve(QStringLiteral("folder"));

    static const QMimeDatabase db;
    const auto mime = db.mimeTypeForName(mimeType);

    QString icon = IconThemeResolver::resolve(mime.iconName());
    if (icon.isEmpty())
        icon = IconThemeResolver::resolve(mime.genericIconName());
    if (icon.isEmpty()) {
        for (const auto& parentName : mime.parentMimeTypes()) {
            icon = IconThemeResolver::resolve(db.mimeTypeForName(parentName).iconName());
            if (!icon.isEmpty())
                break;
        }
    }
    return icon;
}

// Detect FUSE/NFS/CIFS mount points by comparing the filesystem type of a
// directory entry against its parent.  A directory is a remote mount point when
// its own statfs returns a network/FUSE magic number AND that differs from the
// parent directory's filesystem (so we don't flag every subdirectory inside the
// mount — only the mount root).
static bool isRemoteFsType(unsigned long type) {
    return type == FUSE_SUPER_MAGIC
        || type == NFS_SUPER_MAGIC
        || type == SMB_SUPER_MAGIC
        || type == CIFS_SUPER_MAGIC;
}

static bool detectRemoteMount(const QString& path, unsigned long parentFsType) {
    struct statfs sfs;
    if (::statfs(path.toUtf8().constData(), &sfs) != 0)
        return false;
    const auto fsType = static_cast<unsigned long>(sfs.f_type);
    // Only flag the mount root: the entry's fs type differs from its parent's
    return isRemoteFsType(fsType) && fsType != parentFsType;
}

FileSystemEntry::FileSystemEntry(const QString& path, const QString& relativePath, QObject* parent)
    : QObject(parent)
    , m_fileInfo(path)
    , m_path(path)
    , m_relativePath(relativePath)
    , m_isImage([this]() {
        if (m_fileInfo.isDir()) return false;
        if (m_path.endsWith(QStringLiteral(".rpgmvp"), Qt::CaseInsensitive)
            || m_path.endsWith(QStringLiteral(".png_"), Qt::CaseInsensitive)
            || m_path.endsWith(QStringLiteral(".icns"), Qt::CaseInsensitive))
            return true;
        return QImageReader(m_path).canRead();
      }())
    , m_mimeType([this]() -> QString {
        if (m_fileInfo.isDir()) return {};
        static const QMimeDatabase db;
        return db.mimeTypeForFile(m_path).name();
      }())
    , m_isVideo(m_mimeType.startsWith(QStringLiteral("video/")))
    , m_iconPath(resolveIconPath(m_fileInfo, m_mimeType))
    , m_permissions(buildPermissions(m_fileInfo))
    , m_owner(m_fileInfo.owner())
    , m_isRemoteMount(false) {}

FileSystemEntry::FileSystemEntry(CachedEntryData&& data, QObject* parent)
    : QObject(parent)
    , m_fileInfo(std::move(data.fileInfo))
    , m_path(std::move(data.path))
    , m_relativePath(std::move(data.relativePath))
    , m_isImage(data.isImage)
    , m_mimeType(std::move(data.mimeType))
    , m_isVideo(data.isVideo)
    , m_iconPath(resolveIconPath(m_fileInfo, m_mimeType))
    , m_permissions(std::move(data.permissions))
    , m_owner(std::move(data.owner))
    , m_isRemoteMount(data.isRemoteMount) {}

QString FileSystemEntry::path() const {
    return m_path;
};

QString FileSystemEntry::relativePath() const {
    return m_relativePath;
};

QString FileSystemEntry::name() const {
    return m_fileInfo.fileName();
};

QString FileSystemEntry::baseName() const {
    return m_fileInfo.baseName();
};

QString FileSystemEntry::parentDir() const {
    return m_fileInfo.absolutePath();
};

QString FileSystemEntry::suffix() const {
    return m_fileInfo.completeSuffix();
};

qint64 FileSystemEntry::size() const {
    return m_fileInfo.size();
};

bool FileSystemEntry::isDir() const {
    return m_fileInfo.isDir();
};

bool FileSystemEntry::isImage() const { return m_isImage; }
bool FileSystemEntry::isVideo() const { return m_isVideo; }

QDateTime FileSystemEntry::modifiedDate() const {
    return m_fileInfo.lastModified();
}

// Static helper — keeps the constructor initialiser list clean and ensures
// m_permissions is built exactly once per entry lifetime.
static QString buildPermissions(const QFileInfo& info) {
    const auto p = info.permissions();
    QString s;
    s.reserve(10);
    // isSymLink() must be checked before isDir() because a symlink to a directory
    // satisfies both; the first character should reflect the entry type, not the target.
    s += info.isSymLink() ? 'l' : (info.isDir() ? 'd' : '-');
    s += (p & QFileDevice::ReadOwner)  ? 'r' : '-';
    s += (p & QFileDevice::WriteOwner) ? 'w' : '-';
    s += (p & QFileDevice::ExeOwner)   ? 'x' : '-';
    s += (p & QFileDevice::ReadGroup)  ? 'r' : '-';
    s += (p & QFileDevice::WriteGroup) ? 'w' : '-';
    s += (p & QFileDevice::ExeGroup)   ? 'x' : '-';
    s += (p & QFileDevice::ReadOther)  ? 'r' : '-';
    s += (p & QFileDevice::WriteOther) ? 'w' : '-';
    s += (p & QFileDevice::ExeOther)   ? 'x' : '-';
    return s;
}

QString FileSystemEntry::permissions() const {
    return m_permissions;
}

bool FileSystemEntry::isSymlink() const {
    // Safe as CONSTANT: FileSystemEntry is always destroyed and recreated via
    // applyChanges() on any filesystem add/remove event, so stale values cannot
    // accumulate across entry lifetimes.
    return m_fileInfo.isSymLink();
}

QString FileSystemEntry::symlinkTarget() const {
    return m_fileInfo.symLinkTarget();
}

bool FileSystemEntry::isExecutable() const {
    return m_fileInfo.isExecutable();
}

QString FileSystemEntry::owner() const {
    // m_owner is pre-computed in the constructor; owner() is a blocking syscall
    // (getpwuid) on Linux and must not be called on the UI thread at render time.
    return m_owner;
}

bool FileSystemEntry::isRemoteMount() const {
    return m_isRemoteMount;
}

QString FileSystemEntry::mimeType() const { return m_mimeType; }
QString FileSystemEntry::iconPath() const { return m_iconPath; }

void FileSystemEntry::updateRelativePath(const QDir& dir) {
    const auto relPath = dir.relativeFilePath(m_path);
    if (m_relativePath != relPath) {
        m_relativePath = relPath;
        emit relativePathChanged();
    }
}

FileSystemModel::FileSystemModel(QObject* parent)
    : QAbstractListModel(parent)
    , m_recursive(false)
    , m_watchChanges(true)
    , m_showHidden(false)
    , m_sortReverse(false)
    , m_sortBy(Natural)
    , m_filter(NoFilter) {
    connect(&m_watcher, &QFileSystemWatcher::directoryChanged, this, &FileSystemModel::watchDirIfRecursive);
    connect(&m_watcher, &QFileSystemWatcher::directoryChanged, this, &FileSystemModel::updateEntriesForDir);
}

int FileSystemModel::rowCount(const QModelIndex& parent) const {
    if (parent != QModelIndex()) {
        return 0;
    }
    return static_cast<int>(m_entries.size());
}

QVariant FileSystemModel::data(const QModelIndex& index, int role) const {
    if (role != Qt::UserRole || !index.isValid() || index.row() >= static_cast<int>(m_entries.size())) {
        return QVariant();
    }
    return QVariant::fromValue(m_entries.at(index.row()));
}

QHash<int, QByteArray> FileSystemModel::roleNames() const {
    return { { Qt::UserRole, "modelData" } };
}

QString FileSystemModel::path() const {
    return m_path;
}

void FileSystemModel::setPath(const QString& path) {
    if (m_path == path) {
        return;
    }

    m_path = path;
    emit pathChanged();

    m_dir.setPath(m_path);

    for (const auto& entry : std::as_const(m_entries)) {
        entry->updateRelativePath(m_dir);
    }

    update();
}

bool FileSystemModel::recursive() const {
    return m_recursive;
}

void FileSystemModel::setRecursive(bool recursive) {
    if (m_recursive == recursive) {
        return;
    }

    m_recursive = recursive;
    emit recursiveChanged();

    update();
}

bool FileSystemModel::watchChanges() const {
    return m_watchChanges;
}

void FileSystemModel::setWatchChanges(bool watchChanges) {
    if (m_watchChanges == watchChanges) {
        return;
    }

    m_watchChanges = watchChanges;
    emit watchChangesChanged();

    update();
}

bool FileSystemModel::showHidden() const {
    return m_showHidden;
}

void FileSystemModel::setShowHidden(bool showHidden) {
    if (m_showHidden == showHidden) {
        return;
    }

    m_showHidden = showHidden;
    emit showHiddenChanged();

    update();
}

bool FileSystemModel::sortReverse() const {
    return m_sortReverse;
}

void FileSystemModel::setSortReverse(bool sortReverse) {
    if (m_sortReverse == sortReverse) {
        return;
    }

    m_sortReverse = sortReverse;
    emit sortReverseChanged();

    resort();
}

FileSystemModel::SortBy FileSystemModel::sortBy() const {
    return m_sortBy;
}

void FileSystemModel::setSortBy(SortBy sortBy) {
    if (m_sortBy == sortBy) {
        return;
    }

    m_sortBy = sortBy;
    emit sortByChanged();

    resort();
}

FileSystemModel::Filter FileSystemModel::filter() const {
    return m_filter;
}

void FileSystemModel::setFilter(Filter filter) {
    if (m_filter == filter) {
        return;
    }

    m_filter = filter;
    emit filterChanged();

    update();
}

QStringList FileSystemModel::nameFilters() const {
    return m_nameFilters;
}

void FileSystemModel::setNameFilters(const QStringList& nameFilters) {
    if (m_nameFilters == nameFilters) {
        return;
    }

    m_nameFilters = nameFilters;
    emit nameFiltersChanged();

    update();
}

QQmlListProperty<FileSystemEntry> FileSystemModel::entries() {
    return QQmlListProperty<FileSystemEntry>(this, &m_entries);
}

bool FileSystemModel::loading() const {
    return m_loading;
}

void FileSystemModel::watchDirIfRecursive(const QString& path) {
    if (m_recursive && m_watchChanges) {
        const auto currentDir = m_dir;
        const bool showHidden = m_showHidden;
        const auto future = QtConcurrent::run([showHidden, path]() {
            QDir::Filters filters = QDir::Dirs | QDir::NoDotAndDotDot;
            if (showHidden) {
                filters |= QDir::Hidden;
            }

            QDirIterator iter(path, filters, QDirIterator::Subdirectories);
            QStringList dirs;
            while (iter.hasNext()) {
                dirs << iter.next();
            }
            return dirs;
        });
        const auto watcher = new QFutureWatcher<QStringList>(this);
        connect(watcher, &QFutureWatcher<QStringList>::finished, this, [currentDir, showHidden, watcher, this]() {
            const auto paths = watcher->result();
            if (currentDir == m_dir && showHidden == m_showHidden && !paths.isEmpty()) {
                // Ignore if dir or showHidden has changed
                m_watcher.addPaths(paths);
            }
            watcher->deleteLater();
        });
        watcher->setFuture(future);
    }
}

void FileSystemModel::resort() {
    if (m_entries.isEmpty()) {
        return;
    }

    beginResetModel();
    std::sort(m_entries.begin(), m_entries.end(), [this](const FileSystemEntry* a, const FileSystemEntry* b) {
        return compareEntries(a, b);
    });
    endResetModel();

    emit entriesChanged();
}

void FileSystemModel::update() {
    updateWatcher();
    updateEntries();
}

void FileSystemModel::updateWatcher() {
    if (!m_watcher.directories().isEmpty()) {
        m_watcher.removePaths(m_watcher.directories());
    }

    if (!m_watchChanges || m_path.isEmpty()) {
        return;
    }

    m_watcher.addPath(m_path);
    watchDirIfRecursive(m_path);
}

void FileSystemModel::updateEntries() {
    if (m_path.isEmpty()) {
        if (m_loading) {
            m_loading = false;
            emit loadingChanged();
        }
        if (!m_entries.isEmpty()) {
            beginResetModel();
            qDeleteAll(m_entries);
            m_entries.clear();
            endResetModel();
            emit entriesChanged();
        }

        return;
    }

    for (auto& future : m_futures) {
        future.cancel();
    }
    m_futures.clear();

    // Clear stale entries from the previous directory before starting the async scan.
    // For local directories the new entries arrive within one frame (~50ms), so the
    // empty state is invisible.  For remote mounts, the loading indicator fills the gap.
    if (!m_entries.isEmpty()) {
        beginResetModel();
        qDeleteAll(m_entries);
        m_entries.clear();
        endResetModel();
        emit entriesChanged();
    }

    updateEntriesForDir(m_path);
}

void FileSystemModel::updateEntriesForDir(const QString& dir) {
    if (!m_loading) {
        m_loading = true;
        emit loadingChanged();
    }

    const auto recursive = m_recursive;
    const auto showHidden = m_showHidden;
    const auto filter = m_filter;
    const auto nameFilters = m_nameFilters;
    const QDir currentDir = m_dir;

    QSet<QString> oldPaths;
    for (const auto& entry : std::as_const(m_entries)) {
        oldPaths << entry->path();
    }

    const auto future = QtConcurrent::run([=](QPromise<QPair<QSet<QString>, QList<CachedEntryData>>>& promise) {
        // Get the parent directory's filesystem type so we can detect mount boundaries
        struct statfs parentSfs;
        // 0 is used as a sentinel for "parent statfs failed" — an entry whose
        // own f_type is 0 would not match any known remote magic, so it stays safe.
        const unsigned long parentFsType = (::statfs(dir.toUtf8().constData(), &parentSfs) == 0)
            ? static_cast<unsigned long>(parentSfs.f_type) : 0;

        const auto flags = recursive ? QDirIterator::Subdirectories : QDirIterator::NoIteratorFlags;

        std::optional<QDirIterator> iter;

        if (filter == Images) {
            QStringList extraNameFilters = nameFilters;
            // supportedImageFormats() is a static list that never changes at runtime — cache it.
            static const auto formats = QImageReader::supportedImageFormats();
            for (const auto& format : formats) {
                extraNameFilters << "*." + format;
            }
            extraNameFilters << QStringLiteral("*.rpgmvp") << QStringLiteral("*.png_") << QStringLiteral("*.icns");

            QDir::Filters filters = QDir::Files;
            if (showHidden) {
                filters |= QDir::Hidden;
            }

            iter.emplace(dir, extraNameFilters, filters, flags);
        } else {
            QDir::Filters filters;

            if (filter == Files) {
                filters = QDir::Files;
            } else if (filter == Dirs) {
                filters = QDir::Dirs | QDir::NoDotAndDotDot;
            } else {
                filters = QDir::Dirs | QDir::Files | QDir::NoDotAndDotDot;
            }

            if (showHidden) {
                filters |= QDir::Hidden;
            }

            if (nameFilters.isEmpty()) {
                iter.emplace(dir, filters, flags);
            } else {
                iter.emplace(dir, nameFilters, filters, flags);
            }
        }

        QSet<QString> newPaths;
        while (iter->hasNext()) {
            if (promise.isCanceled()) {
                return;
            }

            QString path = iter->next();

            if (filter == Images) {
                // These formats use custom decoders (not QImageReader) — skip the
                // canRead() check which would incorrectly reject them.
                if (!path.endsWith(QStringLiteral(".rpgmvp"), Qt::CaseInsensitive)
                    && !path.endsWith(QStringLiteral(".png_"), Qt::CaseInsensitive)
                    && !path.endsWith(QStringLiteral(".icns"), Qt::CaseInsensitive)) {
                    QImageReader reader(path);
                    if (!reader.canRead()) {
                        continue;
                    }
                }
            }

            newPaths.insert(path);
        }

        if (promise.isCanceled())
            return;
        if (newPaths == oldPaths) {
            // No changes — emit an empty result so the watcher always fires and
            // clears m_loading on the main thread, even when nothing changed.
            promise.addResult(qMakePair(QSet<QString>{}, QList<CachedEntryData>{}));
            return;
        }

        const QSet<QString> removed = oldPaths - newPaths;
        const QSet<QString> added = newPaths - oldPaths;

        // Build CachedEntryData in the background thread so that stat() calls
        // (which block on SSHFS/FUSE) never run on the main/GUI thread.
        QList<CachedEntryData> cachedEntries;
        cachedEntries.reserve(added.size());
        for (const auto& entryPath : added) {
            if (promise.isCanceled()) return;
            CachedEntryData data;
            data.path = entryPath;
            data.relativePath = currentDir.relativeFilePath(entryPath);
            data.fileInfo = QFileInfo(entryPath);
            data.permissions = buildPermissions(data.fileInfo);
            data.owner = data.fileInfo.owner();
            data.isRemoteMount = data.fileInfo.isDir() && detectRemoteMount(data.path, parentFsType);

            // Pre-compute MIME type and image detection in the background thread
            // so FileSystemEntry accessors become trivial field reads with no I/O.
            // QMimeDatabase is thread-safe; QImageReader::canRead() is stack-local.
            if (!data.fileInfo.isDir()) {
                static const QMimeDatabase mimeDb;
                data.mimeType = mimeDb.mimeTypeForFile(data.path).name();
                data.isVideo = data.mimeType.startsWith(QStringLiteral("video/"));

                if (data.path.endsWith(QStringLiteral(".rpgmvp"), Qt::CaseInsensitive)
                    || data.path.endsWith(QStringLiteral(".png_"), Qt::CaseInsensitive)
                    || data.path.endsWith(QStringLiteral(".icns"), Qt::CaseInsensitive)) {
                    data.isImage = true;
                } else {
                    QImageReader reader(data.path);
                    data.isImage = reader.canRead();
                }
            }

            cachedEntries.append(std::move(data));
        }

        promise.addResult(qMakePair(std::move(removed), std::move(cachedEntries)));
    });

    if (m_futures.contains(dir)) {
        m_futures[dir].cancel();
    }
    m_futures.insert(dir, future);

    const auto watcher = new QFutureWatcher<QPair<QSet<QString>, QList<CachedEntryData>>>(this);

    connect(watcher, &QFutureWatcher<QPair<QSet<QString>, QList<CachedEntryData>>>::finished, this, [dir, watcher, this]() {
        m_futures.remove(dir);

        // Safe for now: a canceled watcher cannot fire between m_futures.clear()
        // and updateEntriesForDir() because both run synchronously on the main
        // thread and Qt delivers the finished signal via the event loop.  If the
        // scan lifecycle ever becomes re-entrant, m_loading should be derived
        // from m_futures.isEmpty() rather than toggled manually.
        if (m_futures.isEmpty() && m_loading) {
            m_loading = false;
            emit loadingChanged();
        }

        if (!watcher->future().isResultReadyAt(0)) {
            watcher->deleteLater();
            return;
        }

        auto result = watcher->result();
        applyChanges(result.first, std::move(result.second));

        watcher->deleteLater();
    });

    watcher->setFuture(future);
}

void FileSystemModel::applyChanges(const QSet<QString>& removedPaths, QList<CachedEntryData> addedEntries) {
    QList<int> removedIndices;
    for (int i = 0; i < m_entries.size(); ++i) {
        if (removedPaths.contains(m_entries[i]->path())) {
            removedIndices << i;
        }
    }
    std::sort(removedIndices.begin(), removedIndices.end(), std::greater<int>());

    // Batch remove old entries
    int start = -1;
    int end = -1;
    for (int idx : std::as_const(removedIndices)) {
        if (start == -1) {
            start = idx;
            end = idx;
        } else if (idx == end - 1) {
            end = idx;
        } else {
            beginRemoveRows(QModelIndex(), end, start);
            for (int i = start; i >= end; --i) {
                m_entries.takeAt(i)->deleteLater();
            }
            endRemoveRows();

            start = idx;
            end = idx;
        }
    }
    if (start != -1) {
        beginRemoveRows(QModelIndex(), end, start);
        for (int i = start; i >= end; --i) {
            m_entries.takeAt(i)->deleteLater();
        }
        endRemoveRows();
    }

    // Create and insert new entries, then resort for correct ordering.
    // resort() emits entriesChanged() after sorting; emit it here only when
    // there are no adds (remove-only path) so the signal fires exactly once.
    if (!addedEntries.isEmpty()) {
        QList<FileSystemEntry*> newEntries;
        for (auto& data : addedEntries) {
            newEntries << new FileSystemEntry(std::move(data), this);
        }

        const auto first = static_cast<int>(m_entries.size());
        const auto last = first + static_cast<int>(newEntries.size()) - 1;
        beginInsertRows(QModelIndex(), first, last);
        m_entries.append(newEntries);
        endInsertRows();

        resort(); // emits entriesChanged()
    } else if (!removedPaths.isEmpty()) {
        emit entriesChanged();
    }
}

bool FileSystemModel::compareEntries(const FileSystemEntry* a, const FileSystemEntry* b) const {
    // Directories always sort before files, regardless of sort direction
    if (a->isDir() != b->isDir()) {
        return a->isDir();
    }

    int cmp = 0;
    switch (m_sortBy) {
    case Alphabetical:
        cmp = a->relativePath().localeAwareCompare(b->relativePath());
        break;
    case Modified: {
        const auto aTime = a->modifiedDate();
        const auto bTime = b->modifiedDate();
        if (aTime < bTime) cmp = -1;
        else if (aTime > bTime) cmp = 1;
        else cmp = a->relativePath().localeAwareCompare(b->relativePath());
        break;
    }
    case Size: {
        if (a->size() < b->size()) cmp = -1;
        else if (a->size() > b->size()) cmp = 1;
        else cmp = a->relativePath().localeAwareCompare(b->relativePath());
        break;
    }
    case Extension: {
        cmp = a->suffix().localeAwareCompare(b->suffix());
        if (cmp == 0)
            cmp = a->relativePath().localeAwareCompare(b->relativePath());
        break;
    }
    case Natural: {
        static thread_local QCollator collator = []() {
            QCollator c;
            c.setNumericMode(true);
            c.setCaseSensitivity(Qt::CaseInsensitive);
            return c;
        }();
        cmp = collator.compare(a->relativePath(), b->relativePath());
        break;
    }
    }
    return m_sortReverse ? cmp > 0 : cmp < 0;
}

} // namespace symmetria::filemanager::models
