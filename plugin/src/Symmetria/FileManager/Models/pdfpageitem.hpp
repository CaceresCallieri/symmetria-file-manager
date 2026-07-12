#pragma once

#include "pdfdocumentmodel.hpp"

#include <qfuturewatcher.h>
#include <qimage.h>
#include <qquickpainteditem.h>
#include <qqmlintegration.h>

namespace symmetria::filemanager::models {

/// One lazily-rasterized PDF page for the in-app viewer's page list.
///
/// A QQuickPaintedItem (not a QQuickImageProvider) deliberately: it needs no
/// engine hook, gets the PdfDocumentModel by direct property assignment, and
/// re-renders with the async + generation-counter pattern the rest of the
/// plugin uses. The worker lambda captures the model's shared PdfRenderContext,
/// so a page render in flight survives the model — or the whole viewer — being
/// destroyed; results landing after a newer request are discarded by the
/// generation check. Rendering is serialized inside PdfRenderContext (poppler
/// is not thread-safe), which naturally rasterizes a scrolled-through list one
/// page at a time.
class PdfPageItem : public QQuickPaintedItem {
    Q_OBJECT
    QML_ELEMENT

    Q_PROPERTY(symmetria::filemanager::models::PdfDocumentModel* document
                   READ document WRITE setDocument NOTIFY documentChanged)
    Q_PROPERTY(int pageIndex READ pageIndex WRITE setPageIndex NOTIFY pageIndexChanged)
    // Pixel width to rasterize at (≈ item width × device pixel ratio). Changing
    // it re-renders — that is how zoom stays crisp instead of scaling a stale
    // raster.
    Q_PROPERTY(int renderWidth READ renderWidth WRITE setRenderWidth NOTIFY renderWidthChanged)
    Q_PROPERTY(bool rendering READ rendering NOTIFY renderingChanged)

public:
    explicit PdfPageItem(QQuickItem* parent = nullptr);
    ~PdfPageItem() override;

    [[nodiscard]] PdfDocumentModel* document() const;
    void setDocument(PdfDocumentModel* document);

    [[nodiscard]] int pageIndex() const;
    void setPageIndex(int index);

    [[nodiscard]] int renderWidth() const;
    void setRenderWidth(int width);

    [[nodiscard]] bool rendering() const;

    void paint(QPainter* painter) override;

signals:
    void documentChanged();
    void pageIndexChanged();
    void renderWidthChanged();
    void renderingChanged();

private:
    void scheduleRender();
    void setRendering(bool rendering);

    PdfDocumentModel* m_document = nullptr;
    int m_pageIndex = -1;
    int m_renderWidth = 0;
    bool m_rendering = false;
    QImage m_image;
    quint64 m_generation = 0;
    QFutureWatcher<QImage>* m_watcher = nullptr;
};

} // namespace symmetria::filemanager::models
