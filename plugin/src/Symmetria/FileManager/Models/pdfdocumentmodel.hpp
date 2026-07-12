#pragma once

#include <qfuturewatcher.h>
#include <qimage.h>
#include <qmutex.h>
#include <qobject.h>
#include <qqmlintegration.h>
#include <qsize.h>

#include <memory>
#include <vector>

namespace Poppler {
class Document;
}

namespace symmetria::filemanager::models {

/// Shared, thread-safe rendering handle for one PDF document.
///
/// PdfDocumentModel publishes it and every PdfPageItem worker captures the
/// shared_ptr into its render lambda, so the poppler document stays alive for
/// as long as any in-flight render needs it — even if the model (or the whole
/// viewer) is destroyed mid-render. poppler-qt6 is NOT thread-safe, so every
/// render is serialized behind the context mutex; page rasterization is
/// sequential by design (a vertical page list loads pages one after another).
struct PdfRenderContext {
    QMutex mutex;
    std::shared_ptr<Poppler::Document> document;
    std::vector<QSizeF> pageSizes;  // points (1/72 in), fixed after load

    /// Rasterize one page at the given pixel width (aspect preserved).
    /// Returns a null QImage when out of range, not loaded, or render failure.
    [[nodiscard]] QImage renderPage(int page, int widthPixels);
};

/// Async poppler-qt6 document handle for the in-app PDF viewer
/// (PdfViewerPopup). Opens the document on a QtConcurrent thread — stale
/// results are discarded when `source` changes mid-load (same watcher pattern
/// as PreviewImageHelper). Encrypted and corrupt files surface through
/// `errorString` instead of crashing the render path.
class PdfDocumentModel : public QObject {
    Q_OBJECT
    QML_ELEMENT

    Q_PROPERTY(QString source READ source WRITE setSource NOTIFY sourceChanged)
    Q_PROPERTY(int pageCount READ pageCount NOTIFY documentChanged)
    Q_PROPERTY(bool ready READ ready NOTIFY documentChanged)
    Q_PROPERTY(bool loading READ loading NOTIFY loadingChanged)
    Q_PROPERTY(QString errorString READ errorString NOTIFY documentChanged)

public:
    explicit PdfDocumentModel(QObject* parent = nullptr);
    ~PdfDocumentModel() override;

    [[nodiscard]] QString source() const;
    void setSource(const QString& path);

    [[nodiscard]] int pageCount() const;
    [[nodiscard]] bool ready() const;
    [[nodiscard]] bool loading() const;
    [[nodiscard]] QString errorString() const;

    /// Page size in PDF points. Invalid (empty) QSizeF when out of range or
    /// the document is not ready — QML uses it for delegate aspect ratios.
    Q_INVOKABLE [[nodiscard]] QSizeF pageSize(int page) const;

    /// The shared render handle PdfPageItem workers capture. Never null; its
    /// document pointer is null until a load succeeds.
    [[nodiscard]] std::shared_ptr<PdfRenderContext> renderContext() const;

signals:
    void sourceChanged();
    /// Emitted whenever the loaded document (and thus pageCount / ready /
    /// errorString / page sizes) changes — including load failures.
    void documentChanged();
    void loadingChanged();

private:
    struct LoadResult {
        std::shared_ptr<Poppler::Document> document;
        std::vector<QSizeF> pageSizes;
        QString error;
    };

    void loadDocument();
    static LoadResult loadDocumentBlocking(const QString& path);
    void applyResult(const LoadResult& result);

    QString m_source;
    QString m_error;
    bool m_loading = false;
    std::shared_ptr<PdfRenderContext> m_context;
    QFutureWatcher<LoadResult>* m_watcher = nullptr;
};

} // namespace symmetria::filemanager::models
