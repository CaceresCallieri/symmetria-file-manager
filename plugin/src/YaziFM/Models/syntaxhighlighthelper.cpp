#include "syntaxhighlighthelper.hpp"

#include <qfile.h>
#include <qfileinfo.h>
#include <qmimedatabase.h>
#include <qtextdocument.h>
#include <qtextlayout.h>
#include <qtextobject.h>
#include <QStringDecoder>

#include <KSyntaxHighlighting/SyntaxHighlighter>
#include <KSyntaxHighlighting/Theme>

namespace symmetria::models {

SyntaxHighlightHelper::SyntaxHighlightHelper(QObject* parent)
    : QObject(parent) {}

QString SyntaxHighlightHelper::filePath() const { return m_filePath; }

void SyntaxHighlightHelper::setFilePath(const QString& path) {
    if (m_filePath == path) return;
    m_filePath = path;
    emit filePathChanged();
    loadFile();
}

QString SyntaxHighlightHelper::highlightedContent() const { return m_highlightedContent; }
QString SyntaxHighlightHelper::language() const { return m_language; }
int SyntaxHighlightHelper::lineCount() const { return m_lineCount; }
bool SyntaxHighlightHelper::truncated() const { return m_truncated; }
bool SyntaxHighlightHelper::loading() const { return m_loading; }
bool SyntaxHighlightHelper::error() const { return m_error; }
bool SyntaxHighlightHelper::hasContent() const { return !m_highlightedContent.isEmpty(); }

// --------------------------------------------------------------------------
// loadFile — reads the file, detects language, and generates highlighted HTML.
//
// The highlighted HTML is generated via a *temporary* QTextDocument that is
// completely isolated from the QML TextEdit. This is intentional — attaching
// a QSyntaxHighlighter directly to the QML TextEdit's QTextDocument disrupts
// QQuickTextEdit's internal rendering state, causing text to disappear on
// subsequent file loads (the first file works by accident because the
// highlighter attaches via setDocument() after QML has already rendered).
// See QUIRKS.md §4 for the full explanation.
// --------------------------------------------------------------------------
void SyntaxHighlightHelper::loadFile() {
    // Reset state
    const bool wasError = m_error;
    m_error = false;
    m_truncated = false;
    m_lineCount = 0;
    m_highlightedContent.clear();
    m_language.clear();

    if (m_filePath.isEmpty()) {
        emit contentChanged();
        if (wasError) emit errorChanged();
        return;
    }

    QFile file(m_filePath);
    if (!file.open(QIODevice::ReadOnly)) {
        m_error = true;
        emit contentChanged();
        emit errorChanged();
        return;
    }

    const QByteArray raw = file.read(MaxBytes);
    const bool byteTruncated = raw.size() == MaxBytes;

    // Binary detection: scan for null bytes in the first BinaryScanBytes
    const qsizetype scanLen = qMin<qsizetype>(raw.size(), BinaryScanBytes);
    for (qsizetype i = 0; i < scanLen; ++i) {
        if (raw.at(i) == '\0') {
            m_error = true;
            emit contentChanged();
            emit errorChanged();
            return;
        }
    }

    // Decode UTF-8 (replacement chars for invalid sequences)
    QStringDecoder decoder(QStringDecoder::Utf8);
    QString text = decoder.decode(raw);

    // Truncate to MaxLines
    bool linesTruncated = false;
    int newlineCount = 0;
    for (int i = 0; i < text.size(); ++i) {
        if (text.at(i) == u'\n') {
            ++newlineCount;
            if (newlineCount >= MaxLines) {
                text.truncate(i + 1);
                linesTruncated = true;
                break;
            }
        }
    }

    m_lineCount = linesTruncated ? MaxLines + 1 : newlineCount + 1;
    m_truncated = byteTruncated || linesTruncated;

    // Detect language from filename, then fallback to MIME type
    auto def = m_repository.definitionForFileName(QFileInfo(m_filePath).fileName());
    if (!def.isValid()) {
        static const QMimeDatabase mimeDb;
        const auto mime = mimeDb.mimeTypeForFile(
            m_filePath, QMimeDatabase::MatchExtension
        );
        def = m_repository.definitionForMimeType(mime.name());
    }

    m_language = def.isValid() ? def.translatedName() : QString();

    // Use the dark theme's normal text color as the <pre> tag's default color.
    // Without this, RichText mode defaults to black text (HTML standard),
    // making text invisible on our dark background.
    const auto theme = m_repository.defaultTheme(
        KSyntaxHighlighting::Repository::DarkTheme);
    const QColor normalColor(theme.textColor(KSyntaxHighlighting::Theme::Normal));
    const QString preOpen = QStringLiteral("<pre style=\"margin:0;padding:0;color:")
        + normalColor.name() + QStringLiteral("\">");

    // Generate highlighted HTML via a temporary QTextDocument.
    // See buildHighlightedHtml() for the full architecture explanation.
    if (def.isValid()) {
        m_highlightedContent = preOpen + buildHighlightedHtml(text, def)
            + QStringLiteral("</pre>");
    } else {
        // No language definition — wrap escaped plain text in <pre>
        m_highlightedContent = preOpen + text.toHtmlEscaped()
            + QStringLiteral("</pre>");
    }

    emit contentChanged();
    if (wasError) emit errorChanged();
}

// --------------------------------------------------------------------------
// buildHighlightedHtml — the core highlighting pipeline.
//
// Architecture: highlight on a temporary QTextDocument, then extract the
// formatting data and build lightweight HTML with only <span> color tags.
//
// WHY NOT attach the highlighter to the QML TextEdit's document directly?
//   QSyntaxHighlighter::rehighlight() calls QTextDocument::markContentsDirty()
//   which disrupts QQuickTextEdit's internal rendering state. The first file
//   renders correctly (the highlighter attaches after QML has already processed
//   the text binding), but subsequent file loads cause the text to vanish.
//   This is a fundamental incompatibility between QSyntaxHighlighter (designed
//   for QTextEdit widgets) and QQuickTextEdit (scene graph renderer).
//   See QUIRKS.md §4.
//
// WHY read from QTextLayout::formats() instead of QTextFragment?
//   QSyntaxHighlighter stores its output on QTextLayout's additional formats
//   layer via setFormats(), NOT on the QTextDocument's fragment/character format
//   layer. Iterating QTextFragment objects returns the document's base
//   formatting (always empty/default), not the syntax highlighting colors.
//   See QUIRKS.md §5.
//
// WHY set theme before definition?
//   setDefinition() triggers rehighlight(). Without a valid theme,
//   Format::toTextCharFormat(invalidTheme) resolves all colors to #000000.
//   Those stale black formats persist in the QTextLayout even after setTheme()
//   triggers its own rehighlight — Qt's applyFormatChanges() optimization
//   fails to detect the difference and doesn't overwrite them.
//   See QUIRKS.md §6.
// --------------------------------------------------------------------------
QString SyntaxHighlightHelper::buildHighlightedHtml(
    const QString& text, const KSyntaxHighlighting::Definition& def)
{
    QTextDocument tempDoc;
    tempDoc.setPlainText(text);

    KSyntaxHighlighting::SyntaxHighlighter highlighter(&tempDoc);

    // CRITICAL: setTheme() MUST be called before setDefinition().
    // See the function-level comment above for the full explanation.
    highlighter.setTheme(
        m_repository.defaultTheme(KSyntaxHighlighting::Repository::DarkTheme));
    highlighter.setDefinition(def);

    // Extract format ranges from QTextLayout (NOT QTextFragment — see above).
    // Build lightweight HTML with only color/bold/italic spans, no font info.
    // The QML TextEdit's font properties apply as the base.
    QString html;
    html.reserve(text.size() * 2);

    QTextBlock block = tempDoc.begin();
    while (block.isValid()) {
        const QString blockText = block.text();
        const auto formats = block.layout()->formats();

        int pos = 0;
        for (const auto& range : formats) {
            // Text before this range — inherits <pre> default color
            if (range.start > pos) {
                html += blockText.mid(pos, range.start - pos).toHtmlEscaped();
            }

            const QColor fg = range.format.foreground().color();
            const bool bold = (range.format.fontWeight() >= QFont::Bold);
            const bool italic = range.format.fontItalic();
            const QString escaped = blockText.mid(range.start, range.length).toHtmlEscaped();

            if (fg.isValid() || bold || italic) {
                html += QStringLiteral("<span style=\"");
                if (fg.isValid())
                    html += QStringLiteral("color:") + fg.name() + u';';
                if (bold)
                    html += QStringLiteral("font-weight:bold;");
                if (italic)
                    html += QStringLiteral("font-style:italic;");
                html += QStringLiteral("\">") + escaped + QStringLiteral("</span>");
            } else {
                html += escaped;
            }

            pos = range.start + range.length;
        }

        // Remaining text after last range
        if (pos < blockText.size()) {
            html += blockText.mid(pos).toHtmlEscaped();
        }

        block = block.next();
        if (block.isValid())
            html += u'\n';
    }

    return html;
}

} // namespace symmetria::models
