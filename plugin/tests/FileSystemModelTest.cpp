// FileSystemModelTest — unit tests for the filesystem model.
//
// All test directories are created in QTemporaryDir. File watcher tests use
// generous timeouts to accommodate kernel inotify latency.

#include "filesystemmodel.hpp"

#include <QAbstractItemModelTester>
#include <QDir>
#include <QFile>
#include <QSignalSpy>
#include <QTemporaryDir>
#include <QTest>

using namespace symmetria::filemanager::models;

class FileSystemModelTest : public QObject {
    Q_OBJECT

private:
    // Create a file with the given size (filled with 'x' bytes).
    static bool createFile(const QString& path, qint64 size = 0)
    {
        QFile f(path);
        if (!f.open(QIODevice::WriteOnly))
            return false;
        if (size > 0)
            f.write(QByteArray(static_cast<int>(size), 'x'));
        return true;
    }

    // Wait for the model to finish its async scan.
    static bool waitForEntries(FileSystemModel& model, int timeout = 5000)
    {
        if (!model.loading())
            return true;
        QSignalSpy spy(&model, &FileSystemModel::loadingChanged);
        while (model.loading()) {
            if (!spy.wait(timeout))
                return false;
        }
        return true;
    }

    // Collect entry names from the model in current order.
    static QStringList entryNames(FileSystemModel& model)
    {
        QStringList names;
        for (int i = 0; i < model.rowCount(); ++i) {
            const QVariant v = model.data(model.index(i, 0), Qt::UserRole);
            const auto* entry = v.value<FileSystemEntry*>();
            if (entry)
                names.append(entry->name());
        }
        return names;
    }

    // Return whether an entry at the given index is a directory.
    static bool entryIsDir(FileSystemModel& model, int i)
    {
        const QVariant v = model.data(model.index(i, 0), Qt::UserRole);
        const auto* entry = v.value<FileSystemEntry*>();
        return entry && entry->isDir();
    }

private slots:
    void modelTester()
    {
        QTemporaryDir tmpDir;
        QVERIFY(tmpDir.isValid());
        createFile(tmpDir.path() + "/alpha.txt", 10);
        createFile(tmpDir.path() + "/bravo.txt", 20);
        QDir(tmpDir.path()).mkdir("charlie_dir");

        FileSystemModel model;
        QAbstractItemModelTester tester(&model, QAbstractItemModelTester::FailureReportingMode::QtTest);

        model.setPath(tmpDir.path());
        QVERIFY(waitForEntries(model));
        QVERIFY(model.rowCount() > 0);
    }

    void sortAlphabeticalAsc()
    {
        QTemporaryDir tmpDir;
        QVERIFY(tmpDir.isValid());
        createFile(tmpDir.path() + "/charlie.txt");
        createFile(tmpDir.path() + "/alpha.txt");
        createFile(tmpDir.path() + "/bravo.txt");

        FileSystemModel model;
        model.setSortBy(FileSystemModel::Alphabetical);
        model.setSortReverse(false);
        model.setPath(tmpDir.path());
        QVERIFY(waitForEntries(model));

        const QStringList names = entryNames(model);
        QCOMPARE(names, (QStringList{"alpha.txt", "bravo.txt", "charlie.txt"}));
    }

    void sortAlphabeticalDesc()
    {
        QTemporaryDir tmpDir;
        QVERIFY(tmpDir.isValid());
        createFile(tmpDir.path() + "/charlie.txt");
        createFile(tmpDir.path() + "/alpha.txt");
        createFile(tmpDir.path() + "/bravo.txt");

        FileSystemModel model;
        model.setSortBy(FileSystemModel::Alphabetical);
        model.setSortReverse(true);
        model.setPath(tmpDir.path());
        QVERIFY(waitForEntries(model));

        const QStringList names = entryNames(model);
        QCOMPARE(names, (QStringList{"charlie.txt", "bravo.txt", "alpha.txt"}));
    }

    void sortBySize()
    {
        QTemporaryDir tmpDir;
        QVERIFY(tmpDir.isValid());
        createFile(tmpDir.path() + "/big.txt", 300);
        createFile(tmpDir.path() + "/small.txt", 10);
        createFile(tmpDir.path() + "/medium.txt", 100);

        FileSystemModel model;
        model.setSortBy(FileSystemModel::Size);
        model.setSortReverse(false);
        model.setPath(tmpDir.path());
        QVERIFY(waitForEntries(model));

        const QStringList names = entryNames(model);
        QCOMPARE(names, (QStringList{"small.txt", "medium.txt", "big.txt"}));
    }

    void sortByModified()
    {
        QTemporaryDir tmpDir;
        QVERIFY(tmpDir.isValid());

        // Create files with known modification times (1-second apart)
        const QString pathOld = tmpDir.path() + "/old.txt";
        const QString pathNew = tmpDir.path() + "/new.txt";
        const QString pathMid = tmpDir.path() + "/mid.txt";
        createFile(pathOld);
        createFile(pathMid);
        createFile(pathNew);

        // Force distinct timestamps by setting them explicitly
        const QDateTime base = QDateTime::currentDateTime().addSecs(-100);
        {
            QFile f(pathOld);
            QVERIFY(f.open(QIODevice::ReadWrite));
            QVERIFY(f.setFileTime(base, QFileDevice::FileModificationTime));
        }
        {
            QFile f(pathMid);
            QVERIFY(f.open(QIODevice::ReadWrite));
            QVERIFY(f.setFileTime(base.addSecs(10), QFileDevice::FileModificationTime));
        }
        {
            QFile f(pathNew);
            QVERIFY(f.open(QIODevice::ReadWrite));
            QVERIFY(f.setFileTime(base.addSecs(20), QFileDevice::FileModificationTime));
        }

        FileSystemModel model;
        model.setSortBy(FileSystemModel::Modified);
        model.setSortReverse(false);  // oldest first
        model.setPath(tmpDir.path());
        QVERIFY(waitForEntries(model));

        const QStringList names = entryNames(model);
        QCOMPARE(names, (QStringList{"old.txt", "mid.txt", "new.txt"}));
    }

    void sortDirsBeforeFiles()
    {
        QTemporaryDir tmpDir;
        QVERIFY(tmpDir.isValid());
        createFile(tmpDir.path() + "/aaa_file.txt");
        QDir(tmpDir.path()).mkdir("zzz_dir");
        createFile(tmpDir.path() + "/bbb_file.txt");
        QDir(tmpDir.path()).mkdir("aaa_dir");

        FileSystemModel model;
        model.setSortBy(FileSystemModel::Alphabetical);
        model.setSortReverse(false);
        model.setPath(tmpDir.path());
        QVERIFY(waitForEntries(model));

        // Directories must always appear before files, regardless of name
        QVERIFY(model.rowCount() == 4);
        QVERIFY(entryIsDir(model, 0));  // aaa_dir
        QVERIFY(entryIsDir(model, 1));  // zzz_dir
        QVERIFY(!entryIsDir(model, 2)); // aaa_file.txt
        QVERIFY(!entryIsDir(model, 3)); // bbb_file.txt
    }

    void filterByNameGlob()
    {
        QTemporaryDir tmpDir;
        QVERIFY(tmpDir.isValid());
        createFile(tmpDir.path() + "/foo.txt");
        createFile(tmpDir.path() + "/bar.cpp");
        createFile(tmpDir.path() + "/baz.txt");

        FileSystemModel model;
        model.setNameFilters({"*.txt"});
        model.setSortBy(FileSystemModel::Alphabetical);
        model.setSortReverse(false);
        model.setPath(tmpDir.path());
        QVERIFY(waitForEntries(model));

        const QStringList names = entryNames(model);
        QCOMPARE(names, (QStringList{"baz.txt", "foo.txt"}));
    }

    void filterDirsOnly()
    {
        QTemporaryDir tmpDir;
        QVERIFY(tmpDir.isValid());
        createFile(tmpDir.path() + "/file.txt");
        QDir(tmpDir.path()).mkdir("subdir");

        FileSystemModel model;
        model.setFilter(FileSystemModel::Dirs);
        model.setPath(tmpDir.path());
        QVERIFY(waitForEntries(model));

        QCOMPARE(model.rowCount(), 1);
        QVERIFY(entryIsDir(model, 0));
    }

    void filterFilesOnly()
    {
        QTemporaryDir tmpDir;
        QVERIFY(tmpDir.isValid());
        createFile(tmpDir.path() + "/file.txt");
        QDir(tmpDir.path()).mkdir("subdir");

        FileSystemModel model;
        model.setFilter(FileSystemModel::Files);
        model.setPath(tmpDir.path());
        QVERIFY(waitForEntries(model));

        QCOMPARE(model.rowCount(), 1);
        QVERIFY(!entryIsDir(model, 0));
    }

    void asyncScanApplied()
    {
        QTemporaryDir tmpDir;
        QVERIFY(tmpDir.isValid());
        createFile(tmpDir.path() + "/a.txt");
        createFile(tmpDir.path() + "/b.txt");

        FileSystemModel model;
        QSignalSpy loadingSpy(&model, &FileSystemModel::loadingChanged);
        QSignalSpy entriesSpy(&model, &FileSystemModel::entriesChanged);

        model.setPath(tmpDir.path());

        // loading should have been set to true
        QVERIFY(loadingSpy.count() >= 1 || model.loading());

        QVERIFY(waitForEntries(model));
        QCOMPARE(model.loading(), false);
        QVERIFY(entriesSpy.count() >= 1);
        QCOMPARE(model.rowCount(), 2);
    }

    void showHiddenFiles()
    {
        QTemporaryDir tmpDir;
        QVERIFY(tmpDir.isValid());
        createFile(tmpDir.path() + "/visible.txt");
        createFile(tmpDir.path() + "/.hidden");

        FileSystemModel model;
        model.setShowHidden(false);
        model.setPath(tmpDir.path());
        QVERIFY(waitForEntries(model));
        QCOMPARE(model.rowCount(), 1);

        // Enable hidden files — model should rescan
        model.setShowHidden(true);
        QVERIFY(waitForEntries(model));
        QCOMPARE(model.rowCount(), 2);
    }

    void directoryDiffAdd()
    {
        QTemporaryDir tmpDir;
        QVERIFY(tmpDir.isValid());
        createFile(tmpDir.path() + "/existing.txt");

        FileSystemModel model;
        model.setWatchChanges(true);
        model.setPath(tmpDir.path());
        QVERIFY(waitForEntries(model));
        QCOMPARE(model.rowCount(), 1);

        // Create a new file — the watcher should detect it
        QSignalSpy entriesSpy(&model, &FileSystemModel::entriesChanged);
        createFile(tmpDir.path() + "/new_file.txt");

        // Wait for watcher to pick up the change (kernel inotify latency)
        QVERIFY(entriesSpy.wait(5000));
        QVERIFY(waitForEntries(model));
        QCOMPARE(model.rowCount(), 2);
    }

    void directoryDiffRemove()
    {
        QTemporaryDir tmpDir;
        QVERIFY(tmpDir.isValid());
        createFile(tmpDir.path() + "/keep.txt");
        createFile(tmpDir.path() + "/remove.txt");

        FileSystemModel model;
        model.setWatchChanges(true);
        model.setPath(tmpDir.path());
        QVERIFY(waitForEntries(model));
        QCOMPARE(model.rowCount(), 2);

        // Delete a file — the watcher should detect it
        QSignalSpy entriesSpy(&model, &FileSystemModel::entriesChanged);
        QFile::remove(tmpDir.path() + "/remove.txt");

        QVERIFY(entriesSpy.wait(5000));
        QVERIFY(waitForEntries(model));
        QCOMPARE(model.rowCount(), 1);

        const QStringList names = entryNames(model);
        QCOMPARE(names, QStringList{"keep.txt"});
    }
};

QTEST_MAIN(FileSystemModelTest)
#include "FileSystemModelTest.moc"
