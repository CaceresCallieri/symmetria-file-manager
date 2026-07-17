#include "heifdecoder.hpp"

#include <qdir.h>
#include <qfileinfo.h>
#include <qimage.h>

#include <libheif/heif.h>

namespace symmetria::filemanager::models {

namespace HeifDecoder {

QString decodeToPng(const QString& sourcePath, const QString& cachePath) {
    heif_context* ctx = heif_context_alloc();
    if (!ctx)
        return {};

    // libheif is a C API with manual resource ownership. We free each handle
    // exactly once along every exit path; the nested guards below keep that
    // discipline without a full RAII wrapper for one call site.
    auto freeCtx = [&]() -> QString {
        heif_context_free(ctx);
        return {};
    };

    // Keep the UTF-8 buffer alive for the whole read call (constData() would
    // otherwise point into a destroyed temporary).
    const QByteArray srcUtf8 = sourcePath.toUtf8();
    heif_error err = heif_context_read_from_file(ctx, srcUtf8.constData(), nullptr);
    if (err.code != heif_error_Ok)
        return freeCtx();

    heif_image_handle* handle = nullptr;
    err = heif_context_get_primary_image_handle(ctx, &handle);
    if (err.code != heif_error_Ok || !handle)
        return freeCtx();

    // Decode to straight (non-premultiplied) 8-bit interleaved RGBA — matches
    // QImage::Format_RGBA8888 so the wrap below is a plain reinterpretation.
    heif_image* img = nullptr;
    err = heif_decode_image(handle, &img, heif_colorspace_RGB,
                            heif_chroma_interleaved_RGBA, nullptr);
    if (err.code != heif_error_Ok || !img) {
        heif_image_handle_release(handle);
        return freeCtx();
    }

    const int width  = heif_image_get_width(img, heif_channel_interleaved);
    const int height = heif_image_get_height(img, heif_channel_interleaved);

    int stride = 0;
    const uint8_t* data =
        heif_image_get_plane_readonly(img, heif_channel_interleaved, &stride);

    QImage image;
    if (data && width > 0 && height > 0) {
        // Wrap the libheif-owned plane, then deep-copy so the QImage owns its
        // pixels before we release the libheif buffers below.
        image = QImage(data, width, height, stride, QImage::Format_RGBA8888).copy();
    }

    heif_image_release(img);
    heif_image_handle_release(handle);
    heif_context_free(ctx);

    if (image.isNull())
        return {};

    QDir().mkpath(QFileInfo(cachePath).absolutePath());
    if (!image.save(cachePath, "PNG"))
        return {};

    return cachePath;
}

} // namespace HeifDecoder

} // namespace symmetria::filemanager::models
