#include "pdfdocumentmodel.hpp"

#include <poppler-qt6.h>

#include <qfileinfo.h>
#include <qtconcurrentrun.h>

namespace symmetria::filemanager::models {

QImage PdfRenderContext::renderPage(int page, int widthPixels) {
    QMutexLocker locker(&mutex);
    if (!document || page < 0 || static_cast<size_t>(page) >= pageSizes.size() || widthPixels <= 0)
        return {};

    const auto popplerPage = document->page(page);
    if (!popplerPage)
        return {};

    // Scale by the requested pixel width: PDF geometry is in points (72/in),
    // so dpi = 72 * targetPixels / pointWidth renders exactly widthPixels wide.
    const auto pointSize = pageSizes[static_cast<size_t>(page)];
    if (pointSize.width() <= 0)
        return {};
    const double dpi = 72.0 * widthPixels / pointSize.width();
    return popplerPage->renderToImage(dpi, dpi);
}

PdfDocumentModel::PdfDocumentModel(QObject* parent)
    : QObject(parent)
    , m_context(std::make_shared<PdfRenderContext>()) {}

PdfDocumentModel::~PdfDocumentModel() {
    // Cancel in-flight loads without blocking the GUI thread; disconnect first
    // so the finished signal cannot fire against a destroyed this-pointer.
    if (m_watcher) {
        m_watcher->disconnect();
        m_watcher->cancel();
    }
}

QString PdfDocumentModel::source() const { return m_source; }

void PdfDocumentModel::setSource(const QString& path) {
    if (m_source == path) return;
    m_source = path;
    emit sourceChanged();
    loadDocument();
}

int PdfDocumentModel::pageCount() const {
    // Locked reads: applyResult() writes document/pageSizes under this same
    // mutex from the GUI thread. Both sides are GUI-thread-only today so this
    // is currently uncontended, but PdfRenderContext is documented as the
    // shared thread-safe handle — every access to its fields should honor
    // that contract rather than relying on incidental thread confinement.
    QMutexLocker locker(&m_context->mutex);
    return static_cast<int>(m_context->pageSizes.size());
}

bool PdfDocumentModel::ready() const {
    QMutexLocker locker(&m_context->mutex);
    return m_context->document != nullptr;
}

bool PdfDocumentModel::loading() const { return m_loading; }

QString PdfDocumentModel::errorString() const { return m_error; }

QSizeF PdfDocumentModel::pageSize(int page) const {
    QMutexLocker locker(&m_context->mutex);
    if (page < 0 || static_cast<size_t>(page) >= m_context->pageSizes.size())
        return {};
    return m_context->pageSizes[static_cast<size_t>(page)];
}

std::shared_ptr<PdfRenderContext> PdfDocumentModel::renderContext() const {
    return m_context;
}

void PdfDocumentModel::applyResult(const LoadResult& result) {
    {
        // Swap under the render mutex — an in-flight PdfPageItem render holds
        // the lock for its whole call, so the swap blocks until that render
        // finishes and cannot yank the Document out from under it. A worker
        // that hasn't reached the lock yet does not hold a reference to the
        // OLD Document at all (it only captured the shared PdfRenderContext,
        // and reads `context->document` fresh once it acquires the lock) —
        // safety here comes from that mutex ordering, not from the worker
        // keeping the old shared_ptr alive.
        QMutexLocker locker(&m_context->mutex);
        m_context->document = result.document;
        m_context->pageSizes = result.pageSizes;
    }
    m_error = result.error;
    emit documentChanged();
}

void PdfDocumentModel::loadDocument() {
    // Cancel any in-flight load; disconnect so a stale finished cannot fire.
    if (m_watcher) {
        m_watcher->disconnect();
        m_watcher->cancel();
        m_watcher->deleteLater();
        m_watcher = nullptr;
    }

    if (m_source.isEmpty()) {
        if (m_loading) {
            m_loading = false;
            emit loadingChanged();
        }
        applyResult({});
        return;
    }

    if (!m_loading) {
        m_loading = true;
        emit loadingChanged();
    }
    // Clear any stale error from a previous failed load now, not when the new
    // result lands — errorString() is otherwise briefly wrong for a caller
    // that reads it while loading==true (QML gates its error UI on
    // !loading, so this is currently invisible, but the getter itself
    // shouldn't lie).
    m_error.clear();

    const auto capturedSource = m_source;
    m_watcher = new QFutureWatcher<LoadResult>(this);
    connect(m_watcher, &QFutureWatcher<LoadResult>::finished, this,
            [this, capturedSource, watcher = m_watcher]() {
        // Stale result — source changed while the document was opening.
        if (m_source != capturedSource) return;

        const auto result = watcher->result();
        watcher->deleteLater();
        m_watcher = nullptr;

        m_loading = false;
        emit loadingChanged();
        applyResult(result);
    });
    m_watcher->setFuture(QtConcurrent::run(loadDocumentBlocking, capturedSource));
}

PdfDocumentModel::LoadResult PdfDocumentModel::loadDocumentBlocking(const QString& path) {
    LoadResult result;

    if (!QFileInfo::exists(path)) {
        result.error = QStringLiteral("File not found");
        return result;
    }

    auto document = Poppler::Document::load(path);
    if (!document) {
        result.error = QStringLiteral("Not a valid PDF document");
        return result;
    }
    if (document->isLocked()) {
        result.error = QStringLiteral("Encrypted PDF (password-protected)");
        return result;
    }

    document->setRenderHint(Poppler::Document::Antialiasing);
    document->setRenderHint(Poppler::Document::TextAntialiasing);

    const int count = document->numPages();
    result.pageSizes.reserve(static_cast<size_t>(count));
    for (int i = 0; i < count; ++i) {
        const auto page = document->page(i);
        result.pageSizes.push_back(page ? page->pageSizeF() : QSizeF());
    }

    result.document = std::shared_ptr<Poppler::Document>(std::move(document));
    return result;
}

} // namespace symmetria::filemanager::models
