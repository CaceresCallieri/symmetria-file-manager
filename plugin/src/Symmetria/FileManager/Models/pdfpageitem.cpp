#include "pdfpageitem.hpp"

#include <qpainter.h>
#include <qtconcurrentrun.h>

namespace symmetria::filemanager::models {

PdfPageItem::PdfPageItem(QQuickItem* parent)
    : QQuickPaintedItem(parent) {}

PdfPageItem::~PdfPageItem() {
    // Cancel in-flight work without blocking the GUI thread. The worker only
    // touches the captured shared PdfRenderContext, never this item, so it can
    // finish harmlessly after destruction; disconnect stops the finished
    // signal from firing against a dead this-pointer.
    if (m_watcher) {
        m_watcher->disconnect();
        m_watcher->cancel();
    }
}

PdfDocumentModel* PdfPageItem::document() const { return m_document; }

void PdfPageItem::setDocument(PdfDocumentModel* document) {
    if (m_document == document) return;
    if (m_document)
        disconnect(m_document, nullptr, this, nullptr);
    m_document = document;
    if (m_document) {
        // Re-render when the (async) load lands or the model reloads.
        connect(m_document, &PdfDocumentModel::documentChanged,
                this, &PdfPageItem::scheduleRender);
        // A destroyed model mid-render is survivable (the worker holds the
        // shared context) — but drop our raw pointer so no new render starts.
        connect(m_document, &QObject::destroyed, this, [this]() {
            m_document = nullptr;
        });
    }
    emit documentChanged();
    scheduleRender();
}

int PdfPageItem::pageIndex() const { return m_pageIndex; }

void PdfPageItem::setPageIndex(int index) {
    if (m_pageIndex == index) return;
    m_pageIndex = index;
    emit pageIndexChanged();
    scheduleRender();
}

int PdfPageItem::renderWidth() const { return m_renderWidth; }

void PdfPageItem::setRenderWidth(int width) {
    if (m_renderWidth == width) return;
    m_renderWidth = width;
    emit renderWidthChanged();
    scheduleRender();
}

bool PdfPageItem::rendering() const { return m_rendering; }

void PdfPageItem::setRendering(bool rendering) {
    if (m_rendering == rendering) return;
    m_rendering = rendering;
    emit renderingChanged();
}

void PdfPageItem::paint(QPainter* painter) {
    // Page background first — PDFs assume white paper, and it doubles as the
    // placeholder while the raster is still rendering.
    painter->fillRect(QRectF(0, 0, width(), height()), Qt::white);
    if (m_image.isNull())
        return;
    painter->setRenderHint(QPainter::SmoothPixmapTransform);
    painter->drawImage(QRectF(0, 0, width(), height()), m_image);
}

void PdfPageItem::scheduleRender() {
    const quint64 generation = ++m_generation;

    if (m_watcher) {
        m_watcher->disconnect();
        m_watcher->cancel();
        m_watcher->deleteLater();
        m_watcher = nullptr;
    }

    if (!m_document || !m_document->ready() || m_pageIndex < 0 || m_renderWidth <= 0) {
        if (!m_image.isNull()) {
            m_image = QImage();
            update();
        }
        setRendering(false);
        return;
    }

    setRendering(true);

    // Self-contained worker: captures the shared render context (keeps the
    // poppler document alive) and plain ints — never `this`-owned state.
    auto context = m_document->renderContext();
    const int page = m_pageIndex;
    const int width = m_renderWidth;

    m_watcher = new QFutureWatcher<QImage>(this);
    connect(m_watcher, &QFutureWatcher<QImage>::finished, this,
            [this, generation, watcher = m_watcher]() {
        // Stale render — a newer request superseded this one.
        if (generation != m_generation) return;

        m_image = watcher->result();
        watcher->deleteLater();
        m_watcher = nullptr;
        setRendering(false);
        update();
    });
    m_watcher->setFuture(QtConcurrent::run([context, page, width]() {
        return context->renderPage(page, width);
    }));
}

} // namespace symmetria::filemanager::models
