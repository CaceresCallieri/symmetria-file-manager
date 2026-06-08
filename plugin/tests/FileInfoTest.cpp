// FileInfoTest — unit tests for the FileInfo element (path → async
// FileSystemEntry). Uses QTEST_MAIN (not GUILESS) because the entry derivation
// runs QImageReader, which needs QGuiApplication; offscreen platform avoids a
// display server.

#include "fileinfo.hpp"
#include "filesystemmodel.hpp"

#include <QDir>
#include <QFile>
#include <QImage>
#include <QSignalSpy>
#include <QTemporaryDir>
#include <QTest>

using namespace symmetria::filemanager::models;

class FileInfoTest : public QObject {
    Q_OBJECT

private:
    QTemporaryDir m_tmpDir;

    static QString writeText(const QTemporaryDir& dir, const QString& name, const QByteArray& content)
    {
        const QString path = dir.path() + "/" + name;
        QFile f(path);
        if (!f.open(QIODevice::WriteOnly))
            return {};
        f.write(content);
        return path;
    }

    static QString writePng(const QTemporaryDir& dir, const QString& name)
    {
        const QString path = dir.path() + "/" + name;
        QImage img(8, 8, QImage::Format_RGB32);
        img.fill(Qt::red);
        return img.save(path, "PNG") ? path : QString();
    }

    // Wait until the async build settles (loading() returns to false).
    static bool waitForReady(FileInfo& fi, int timeout = 5000)
    {
        if (!fi.loading())
            return true;
        QSignalSpy spy(&fi, &FileInfo::loadingChanged);
        while (fi.loading()) {
            if (!spy.wait(timeout))
                return false;
        }
        return true;
    }

private slots:
    void initTestCase()
    {
        QVERIFY(m_tmpDir.isValid());
    }

    void imageFileDerivesImageEntry()
    {
        const QString path = writePng(m_tmpDir, "pic.png");
        QVERIFY(!path.isEmpty());

        FileInfo fi;
        fi.setPath(path);
        QVERIFY(waitForReady(fi));

        QVERIFY(fi.ready());
        auto* e = fi.entry();
        QVERIFY(e != nullptr);
        QCOMPARE(e->isDir(), false);
        QCOMPARE(e->isImage(), true);
        QCOMPARE(e->isVideo(), false);
        QVERIFY(e->mimeType().startsWith(QStringLiteral("image/")));
        QVERIFY(e->size() > 0);
        QCOMPARE(e->name(), QStringLiteral("pic.png"));
    }

    void textFileDerivesNonImageEntry()
    {
        const QString path = writeText(m_tmpDir, "notes.txt", "hello world\n");

        FileInfo fi;
        fi.setPath(path);
        QVERIFY(waitForReady(fi));

        auto* e = fi.entry();
        QVERIFY(e != nullptr);
        QCOMPARE(e->isDir(), false);
        QCOMPARE(e->isImage(), false);
        QCOMPARE(e->mimeType(), QStringLiteral("text/plain"));
    }

    void directoryDerivesDirEntry()
    {
        const QString dirPath = m_tmpDir.path() + "/subdir";
        QVERIFY(QDir(m_tmpDir.path()).mkpath("subdir"));

        FileInfo fi;
        fi.setPath(dirPath);
        QVERIFY(waitForReady(fi));

        auto* e = fi.entry();
        QVERIFY(e != nullptr);
        QCOMPARE(e->isDir(), true);
        QCOMPARE(e->isImage(), false);
        QCOMPARE(e->isVideo(), false);
    }

    void emptyPathClearsEntry()
    {
        const QString path = writeText(m_tmpDir, "clear.txt", "x\n");

        FileInfo fi;
        fi.setPath(path);
        QVERIFY(waitForReady(fi));
        QVERIFY(fi.entry() != nullptr);

        QSignalSpy entrySpy(&fi, &FileInfo::entryChanged);
        fi.setPath(QString());

        // Empty path clears synchronously — no async round-trip.
        QCOMPARE(fi.ready(), false);
        QCOMPARE(fi.entry(), nullptr);
        QVERIFY(entrySpy.count() >= 1);
    }

    void staleBuildDiscarded()
    {
        const QString pathA = writePng(m_tmpDir, "stale_a.png");
        const QString pathB = writeText(m_tmpDir, "stale_b.txt", "b\n");
        QVERIFY(!pathA.isEmpty());

        FileInfo fi;
        // Set A then immediately B — the generation counter must discard A's
        // result so the final entry reflects B.
        fi.setPath(pathA);
        fi.setPath(pathB);
        QVERIFY(waitForReady(fi));

        auto* e = fi.entry();
        QVERIFY(e != nullptr);
        QCOMPARE(e->name(), QStringLiteral("stale_b.txt"));
        QCOMPARE(e->isImage(), false);
    }
};

QTEST_MAIN(FileInfoTest)
#include "FileInfoTest.moc"
