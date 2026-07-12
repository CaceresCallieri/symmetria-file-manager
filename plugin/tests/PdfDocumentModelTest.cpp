// Tests for PdfDocumentModel + PdfRenderContext — the poppler-qt6 backend of
// the in-app PDF viewer. Fixtures are GENERATED at runtime with QPdfWriter
// (Qt Gui), so no binary blobs live in the repo and the PDFs are guaranteed
// valid for the Qt in use. QT_QPA_PLATFORM=offscreen (set by CMake) covers
// QPdfWriter's QGuiApplication requirement.

#include "pdfdocumentmodel.hpp"

#include <QtTest/QtTest>
#include <qpagelayout.h>
#include <qpagesize.h>
#include <qpainter.h>
#include <qpdfwriter.h>
#include <qtemporarydir.h>

using symmetria::filemanager::models::PdfDocumentModel;

class PdfDocumentModelTest : public QObject {
    Q_OBJECT

private:
    QTemporaryDir m_dir;
    QString m_twoPagePdf;
    QString m_corruptPdf;

    // Block until the model settles (loading finished) or timeout.
    static bool waitForLoad(PdfDocumentModel& model) {
        return QTest::qWaitFor([&model]() { return !model.loading(); }, 5000);
    }

private slots:
    void initTestCase() {
        QVERIFY(m_dir.isValid());

        // Two pages with DIFFERENT sizes (Letter then A5) so per-page geometry
        // is observable.
        m_twoPagePdf = m_dir.filePath(QStringLiteral("two-page.pdf"));
        {
            QPdfWriter writer(m_twoPagePdf);
            writer.setPageSize(QPageSize(QPageSize::Letter));
            QPainter painter(&writer);
            painter.drawText(QPointF(72, 72), QStringLiteral("page one"));
            writer.setPageSize(QPageSize(QPageSize::A5));
            QVERIFY(writer.newPage());
            painter.drawText(QPointF(36, 36), QStringLiteral("page two"));
            painter.end();
        }
        QVERIFY(QFileInfo::exists(m_twoPagePdf));

        m_corruptPdf = m_dir.filePath(QStringLiteral("corrupt.pdf"));
        {
            QFile f(m_corruptPdf);
            QVERIFY(f.open(QIODevice::WriteOnly));
            f.write("%PDF-1.4 this is not really a pdf at all\n");
        }
    }

    void loadsValidPdf() {
        PdfDocumentModel model;
        model.setSource(m_twoPagePdf);
        QVERIFY(waitForLoad(model));

        QVERIFY(model.ready());
        QCOMPARE(model.errorString(), QString());
        QCOMPARE(model.pageCount(), 2);

        // Letter = 612×792 pt; A5 = 420×595 pt. QPdfWriter margins don't
        // change the page box, but allow rounding slack.
        const auto first = model.pageSize(0);
        QVERIFY(qAbs(first.width() - 612.0) < 2.0);
        QVERIFY(qAbs(first.height() - 792.0) < 2.0);
        const auto second = model.pageSize(1);
        QVERIFY(second.width() < first.width());  // A5 is narrower than Letter
    }

    void pageSizeOutOfRangeIsInvalid() {
        PdfDocumentModel model;
        model.setSource(m_twoPagePdf);
        QVERIFY(waitForLoad(model));

        QVERIFY(!model.pageSize(-1).isValid());
        QVERIFY(!model.pageSize(2).isValid());
    }

    void renderPageProducesRequestedWidth() {
        PdfDocumentModel model;
        model.setSource(m_twoPagePdf);
        QVERIFY(waitForLoad(model));

        const auto context = model.renderContext();
        const QImage page = context->renderPage(0, 200);
        QVERIFY(!page.isNull());
        QCOMPARE(page.width(), 200);
        // Aspect follows the page box (792/612 ≈ 1.294).
        QVERIFY(qAbs(page.height() - 200.0 * 792.0 / 612.0) < 2.0);

        // Out-of-range / degenerate requests return null, never crash.
        QVERIFY(context->renderPage(5, 200).isNull());
        QVERIFY(context->renderPage(0, 0).isNull());
        QVERIFY(context->renderPage(-1, 200).isNull());
    }

    void corruptFileSetsError() {
        PdfDocumentModel model;
        model.setSource(m_corruptPdf);
        QVERIFY(waitForLoad(model));

        QVERIFY(!model.ready());
        QVERIFY(!model.errorString().isEmpty());
        QCOMPARE(model.pageCount(), 0);
        QVERIFY(model.renderContext()->renderPage(0, 200).isNull());
    }

    void missingFileSetsError() {
        PdfDocumentModel model;
        model.setSource(m_dir.filePath(QStringLiteral("does-not-exist.pdf")));
        QVERIFY(waitForLoad(model));

        QVERIFY(!model.ready());
        QCOMPARE(model.errorString(), QStringLiteral("File not found"));
    }

    void clearingSourceResetsDocument() {
        PdfDocumentModel model;
        model.setSource(m_twoPagePdf);
        QVERIFY(waitForLoad(model));
        QVERIFY(model.ready());

        model.setSource(QString());
        QVERIFY(waitForLoad(model));
        QVERIFY(!model.ready());
        QCOMPARE(model.pageCount(), 0);
    }

    void sourceSwapDiscardsStaleLoad() {
        PdfDocumentModel model;
        // Swap immediately — the first load must never clobber the second's
        // result (the capturedSource guard).
        model.setSource(m_corruptPdf);
        model.setSource(m_twoPagePdf);
        QVERIFY(waitForLoad(model));

        QVERIFY(model.ready());
        QCOMPARE(model.pageCount(), 2);
        QCOMPARE(model.errorString(), QString());
    }
};

QTEST_MAIN(PdfDocumentModelTest)
#include "PdfDocumentModelTest.moc"
