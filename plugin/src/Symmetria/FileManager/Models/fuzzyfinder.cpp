#include "fuzzyfinder.hpp"

#include <qdir.h>
#include <qdiriterator.h>
#include <qfileinfo.h>
#include <qfuturewatcher.h>
#include <qregularexpression.h>
#include <qtconcurrentrun.h>

#include <algorithm>

namespace symmetria::filemanager::models {

// ─────────────────────────────────────────────────────────────────────────────
// Gitignore parsing
// ─────────────────────────────────────────────────────────────────────────────

struct GitignoreRule {
    QRegularExpression pattern;
    bool negation      = false;  // line started with !
    bool directoryOnly = false;  // line ended with /
};

struct GitignoreRuleSet {
    QString basePath;
    QVector<GitignoreRule> rules;
};

// Convert a gitignore glob pattern to a QRegularExpression.
// Handles: *, **, ?, character classes [abc], leading /, trailing /, !
static QRegularExpression globToRegex(const QString& glob, bool anchored) {
    QString regex;
    regex.reserve(glob.size() * 2);

    int i = 0;
    while (i < glob.size()) {
        const QChar c = glob[i];

        if (c == u'*') {
            if (i + 1 < glob.size() && glob[i + 1] == u'*') {
                // ** — match everything including /
                if (i + 2 < glob.size() && glob[i + 2] == u'/') {
                    regex += QStringLiteral("(.*/)?");
                    i += 3;
                } else {
                    regex += QStringLiteral(".*");
                    i += 2;
                }
            } else {
                // * — match everything except /
                regex += QStringLiteral("[^/]*");
                i++;
            }
        } else if (c == u'?') {
            regex += QStringLiteral("[^/]");
            i++;
        } else if (c == u'[') {
            // Pass through character class as-is
            regex += u'[';
            i++;
            while (i < glob.size() && glob[i] != u']') {
                regex += glob[i];
                i++;
            }
            if (i < glob.size()) {
                regex += u']';
                i++;
            }
        } else {
            regex += QRegularExpression::escape(QString(c));
            i++;
        }
    }

    // Anchored patterns must match from the start; unanchored match any path segment.
    // Both must match to end of string (or next /).
    if (anchored) {
        regex = u'^' + regex;
    } else {
        regex = QStringLiteral("(^|/)") + regex;
    }
    // Match the full remaining path (the pattern matches the complete relative path)
    regex += u'$';

    return QRegularExpression(regex);
}

// Parse a single .gitignore file into a rule set.
// basePath is stored relative to the walk root (empty string for root-level).
static GitignoreRuleSet parseGitignore(const QString& dirPath, const QString& rootPath) {
    GitignoreRuleSet ruleSet;
    // Store relative base path: "" for root dir, "sub" for sub/.gitignore, etc.
    if (dirPath.size() > rootPath.size())
        ruleSet.basePath = dirPath.mid(rootPath.size() + 1);  // skip trailing /

    QFile file(dirPath + QStringLiteral("/.gitignore"));
    if (!file.open(QIODevice::ReadOnly | QIODevice::Text))
        return ruleSet;

    while (!file.atEnd()) {
        QString line = QString::fromUtf8(file.readLine()).trimmed();

        // Skip empty lines and comments
        if (line.isEmpty() || line.startsWith(u'#'))
            continue;

        GitignoreRule rule;

        // Negation
        if (line.startsWith(u'!')) {
            rule.negation = true;
            line = line.mid(1);
        }

        // Directory-only
        if (line.endsWith(u'/')) {
            rule.directoryOnly = true;
            line.chop(1);
        }

        // Leading / means anchored to the .gitignore's directory
        bool anchored = false;
        if (line.startsWith(u'/')) {
            anchored = true;
            line = line.mid(1);
        }

        // Patterns containing / (other than leading) are also anchored
        if (!anchored && line.contains(u'/'))
            anchored = true;

        if (line.isEmpty())
            continue;

        rule.pattern = globToRegex(line, anchored);
        if (rule.pattern.isValid())
            ruleSet.rules.append(std::move(rule));
    }

    return ruleSet;
}

// Check if a relative path is ignored by the gitignore rule stack.
// Rules are checked from most-specific (deepest directory) to least-specific.
// Last matching rule wins; negation re-includes.
static bool isIgnoredByGitignore(
    const QString& relativePath,
    bool isDir,
    const QVector<GitignoreRuleSet>& ruleStack)
{
    bool ignored = false;

    // Process from outermost to innermost — last match wins
    for (const auto& ruleSet : ruleStack) {
        // Compute path relative to this .gitignore's directory.
        // basePath is relative to the walk root (e.g., "" for root, "sub" for sub/).
        QString localPath = relativePath;
        if (!ruleSet.basePath.isEmpty()) {
            const QString prefix = ruleSet.basePath + u'/';
            if (!relativePath.startsWith(prefix))
                continue;
            localPath = relativePath.mid(prefix.size());
        }

        for (const auto& rule : ruleSet.rules) {
            if (rule.directoryOnly && !isDir)
                continue;

            if (rule.pattern.match(localPath).hasMatch()) {
                ignored = !rule.negation;
            }
        }
    }

    return ignored;
}

// ─────────────────────────────────────────────────────────────────────────────
// Directory walking
// ─────────────────────────────────────────────────────────────────────────────

struct WalkResult {
    QVector<CachedPath> paths;
    QString error;
};

// Recursive directory walker with gitignore awareness.
// Runs on a worker thread — no QObject access, pure data in/out.
//
// Returns true to continue walking, false to abort early (cap reached).
// The caller cascades the abort up the recursion stack so the entire
// remaining subtree is short-circuited as soon as MaxScanFiles is hit.
static bool walkRecursive(
    const QString& dirPath,
    const QString& rootPath,
    bool showHidden,
    QVector<GitignoreRuleSet>& ruleStack,
    QSet<QString>& visitedDirs,
    QVector<CachedPath>& out)
{
    // Fast-path: skip QFileInfo + gitignore parse + entryInfoList for this subtree
    // if the cap is already hit. The loop guard below handles mid-iteration caps;
    // this guard avoids redundant work when the recursion itself triggered the cap.
    if (out.size() >= FuzzyFinder::MaxScanFiles)
        return false;

    // Prevent symlink cycles
    const QString canonical = QFileInfo(dirPath).canonicalFilePath();
    if (canonical.isEmpty() || visitedDirs.contains(canonical))
        return true;
    visitedDirs.insert(canonical);

    // Parse .gitignore at this level if it exists
    const auto gitignore = parseGitignore(dirPath, rootPath);
    const bool hasGitignore = !gitignore.rules.isEmpty();
    if (hasGitignore)
        ruleStack.append(gitignore);

    QDir dir(dirPath);
    QDir::Filters filters = QDir::Files | QDir::Dirs | QDir::NoDotAndDotDot;
    if (showHidden)
        filters |= QDir::Hidden;

    const auto entries = dir.entryInfoList(filters, QDir::Name);
    const auto rootLen = rootPath.size() + 1;  // +1 for trailing /

    for (const auto& info : entries) {
        if (out.size() >= FuzzyFinder::MaxScanFiles) {
            if (hasGitignore)
                ruleStack.removeLast();
            return false;
        }

        const QString name = info.fileName();
        const QString fullPath = info.filePath();

        // Always skip .git directory
        if (name == QStringLiteral(".git") && info.isDir())
            continue;

        const QString relativePath = fullPath.mid(rootLen);
        const bool isDir = info.isDir();

        // Compute gitignore-relative path for matching.
        // The ruleStack basePaths are relative to rootPath, so we use relativePath
        // but each ruleSet.basePath is also relative to rootPath.
        if (!ruleStack.isEmpty()) {
            // Build path relative to root for gitignore matching
            if (isIgnoredByGitignore(relativePath, isDir, ruleStack))
                continue;
        }

        // Compute depth from relative path
        int depth = 0;
        for (const QChar& ch : relativePath) {
            if (ch == u'/')
                depth++;
        }

        out.append({relativePath, name, fullPath, isDir, depth});

        if (isDir) {
            if (!walkRecursive(fullPath, rootPath, showHidden, ruleStack, visitedDirs, out)) {
                if (hasGitignore)
                    ruleStack.removeLast();
                return false;
            }
        }
    }

    if (hasGitignore)
        ruleStack.removeLast();

    return true;
}

static WalkResult walkDirectory(const QString& rootPath, bool showHidden) {
    WalkResult result;

    QFileInfo rootInfo(rootPath);
    if (!rootInfo.exists() || !rootInfo.isDir()) {
        result.error = QStringLiteral("Path does not exist or is not a directory");
        return result;
    }

    QVector<GitignoreRuleSet> ruleStack;
    QSet<QString> visitedDirs;

    // Pre-compute the basePath for root-level gitignore rules as empty string
    // (relative paths are already relative to rootPath)
    const bool finished = walkRecursive(
        rootPath, rootPath, showHidden, ruleStack, visitedDirs, result.paths);

    if (!finished) {
        result.error = QStringLiteral(
            "Directory tree too large — indexed first %1 entries (files + directories). Open the finder "
            "from a more specific subdirectory for complete results.")
            .arg(FuzzyFinder::MaxScanFiles);
    }

    return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// Smith-Waterman fuzzy scoring
// ─────────────────────────────────────────────────────────────────────────────

struct ScoreResult {
    int          score = 0;
    QVector<int> matchIndices;
};

static bool isWordBoundary(const QString& text, qsizetype pos) {
    if (pos == 0)
        return true;
    const QChar prev = text[pos - 1];
    const QChar curr = text[pos];
    return prev == u'/' || prev == u'.' || prev == u'_' || prev == u'-' || prev == u' '
        || (prev.isLower() && curr.isUpper());
}

// Smith-Waterman scoring with affine-gap-like bonuses.
// Returns the best alignment score and the matched character positions.
static ScoreResult smithWatermanScore(
    const QString& text,
    const QString& query,
    const QString& filename,
    int depth)
{
    const qsizetype tLen = text.size();
    const qsizetype qLen = query.size();

    if (qLen == 0 || tLen == 0)
        return {};

    // H[i][j] = best score aligning query[0..i-1] with text[0..j-1]
    // Use flat arrays for performance
    QVector<int> H(static_cast<int>((qLen + 1) * (tLen + 1)), 0);

    auto idx = [tLen](qsizetype i, qsizetype j) -> int {
        return static_cast<int>(i * (tLen + 1) + j);
    };

    int bestScore = 0;
    qsizetype bestJ = 0;  // column of best score in last query row

    const QString textLower = text.toLower();
    const QString queryLower = query.toLower();

    // H[i][j] = best score ending with query[i-1] matched to text[j-1].
    // Only populated when characters match; zero otherwise.
    // This guarantees that H[qLen][j] > 0 only if ALL query chars are aligned.
    for (qsizetype i = 1; i <= qLen; ++i) {
        // rowMax tracks max(H[i-1][0..j-1]) as j advances, eliminating the O(n) inner scan.
        int rowMax = 0;
        for (qsizetype j = 1; j <= tLen; ++j) {
            // Update rowMax with H[i-1][j-1] before processing column j.
            // This gives us max(H[i-1][0..j-1]) without a separate inner loop.
            if (i > 1)
                rowMax = std::max(rowMax, H[idx(i - 1, j - 1)]);

            if (queryLower[i - 1] != textLower[j - 1]) {
                // No match — cell stays 0 (default). Skip.
                continue;
            }

            // Characters match (case-insensitive).
            int matchScore = 16;  // base match

            // Consecutive match bonus (previous query char aligned to previous text char)
            if (i > 1 && j > 1 && H[idx(i - 1, j - 1)] > 0)
                matchScore += 8;

            // Word boundary bonus
            if (isWordBoundary(text, j - 1))
                matchScore += 10;

            // First character bonus
            if (i == 1 && isWordBoundary(text, j - 1))
                matchScore += 8;

            // Exact case bonus
            if (query[i - 1] == text[j - 1])
                matchScore += 2;

            // For the first query char (i==1), no predecessor needed.
            // For i>1, rowMax holds max(H[i-1][0..j-1]) — the best predecessor.
            if (i == 1)
                H[idx(i, j)] = matchScore;
            else if (rowMax > 0)
                H[idx(i, j)] = rowMax + matchScore;
            // else: no valid predecessor for this query position → cell stays 0

            // Track best score at the last query row
            if (i == qLen && H[idx(i, j)] > bestScore) {
                bestScore = H[idx(i, j)];
                bestJ = j;
            }
        }
    }

    if (bestScore == 0)
        return {};

    // Traceback to find match indices.
    // Walk backwards: at each query row i, find the j that was used (H[i][j] > 0)
    // and that leads to the best score. Since each row only has entries where
    // a match occurred, we find the cell that contributed to the final score.
    QVector<int> indices;
    indices.reserve(static_cast<int>(qLen));
    qsizetype j = bestJ;
    for (qsizetype i = qLen; i >= 1; --i) {
        // j is the text position used for query char i
        indices.prepend(static_cast<int>(j - 1));  // 0-based index in text

        if (i == 1)
            break;

        // Find the predecessor: best H[i-1][k] for k < j
        int bestPrev = 0;
        qsizetype bestK = 0;
        for (qsizetype k = 1; k < j; ++k) {
            if (H[idx(i - 1, k)] > bestPrev) {
                bestPrev = H[idx(i - 1, k)];
                bestK = k;
            }
        }
        j = bestK;
    }

    // Post-scoring bonuses

    // Filename bonus: compare query against the filename portion
    const QString filenameLower = filename.toLower();
    if (filenameLower == queryLower) {
        bestScore = bestScore * 140 / 100;  // +40% for exact filename match
    } else if (filenameLower.contains(queryLower)) {
        bestScore = bestScore * 116 / 100;  // +16% for substring in filename
    }

    // Path depth penalty
    bestScore -= depth * 2;

    if (bestScore < 1)
        bestScore = 1;  // ensure positive score for any match

    return {bestScore, indices};
}

// ─────────────────────────────────────────────────────────────────────────────
// Scoring pass — runs on worker thread
// ─────────────────────────────────────────────────────────────────────────────

struct ScorePassResult {
    QVector<FuzzyMatchResult> results;
};

static ScorePassResult scoreAllPaths(
    const QVector<CachedPath>& paths,
    const QString& query)
{
    ScorePassResult result;

    QVector<FuzzyMatchResult> scored;
    scored.reserve(paths.size() / 4);  // rough estimate of match ratio

    for (const auto& cached : paths) {
        auto sr = smithWatermanScore(cached.relativePath, query, cached.name, cached.depth);
        if (sr.score > 0) {
            scored.append({
                cached.relativePath,
                cached.name,
                cached.fullPath,
                cached.isDir,
                sr.score,
                std::move(sr.matchIndices),
            });
        }
    }

    // Partial sort: get top MaxResults by score (descending)
    const int n = std::min(static_cast<int>(scored.size()), FuzzyFinder::MaxResults);
    if (n > 0 && scored.size() > n) {
        std::partial_sort(scored.begin(), scored.begin() + n, scored.end(),
            [](const FuzzyMatchResult& a, const FuzzyMatchResult& b) {
                return a.score > b.score;
            });
        scored.resize(n);
    } else if (n > 0) {
        std::sort(scored.begin(), scored.end(),
            [](const FuzzyMatchResult& a, const FuzzyMatchResult& b) {
                return a.score > b.score;
            });
    }

    result.results = std::move(scored);
    return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// FuzzyFinder — QAbstractListModel implementation
// ─────────────────────────────────────────────────────────────────────────────

FuzzyFinder::FuzzyFinder(QObject* parent)
    : QAbstractListModel(parent) {}

int FuzzyFinder::rowCount(const QModelIndex& parent) const {
    if (parent.isValid())
        return 0;
    return static_cast<int>(m_results.size());
}

QVariant FuzzyFinder::data(const QModelIndex& index, int role) const {
    if (!index.isValid() || index.row() < 0 || index.row() >= static_cast<int>(m_results.size()))
        return {};

    const auto& entry = m_results.at(index.row());
    switch (role) {
    case PathRole:         return entry.relativePath;
    case NameRole:         return entry.name;
    case IsDirRole:        return entry.isDir;
    case ScoreRole:        return entry.score;
    case MatchIndicesRole: {
        QVariantList list;
        list.reserve(entry.matchIndices.size());
        for (int idx : entry.matchIndices)
            list.append(idx);
        return list;
    }
    case FullPathRole:     return entry.fullPath;
    default:               return {};
    }
}

QHash<int, QByteArray> FuzzyFinder::roleNames() const {
    return {
        {PathRole,         "path"},
        {NameRole,         "name"},
        {IsDirRole,        "isDir"},
        {ScoreRole,        "score"},
        {MatchIndicesRole, "matchIndices"},
        {FullPathRole,     "fullPath"},
    };
}

QString FuzzyFinder::searchPath() const { return m_searchPath; }

void FuzzyFinder::setSearchPath(const QString& path) {
    if (m_searchPath == path)
        return;
    m_searchPath = path;
    emit searchPathChanged();
    startWalk();
}

QString FuzzyFinder::query() const { return m_query; }

void FuzzyFinder::setQuery(const QString& query) {
    if (m_query == query)
        return;
    m_query = query;
    emit queryChanged();
    startScoring();
}

bool FuzzyFinder::showHidden() const { return m_showHidden; }

void FuzzyFinder::setShowHidden(bool show) {
    if (m_showHidden == show)
        return;
    m_showHidden = show;
    emit showHiddenChanged();
    // Re-walk with new visibility setting
    if (!m_searchPath.isEmpty())
        startWalk();
}

bool FuzzyFinder::scanning() const { return m_scanning; }
bool FuzzyFinder::loading() const { return m_loading; }
int FuzzyFinder::resultCount() const { return static_cast<int>(m_results.size()); }
QString FuzzyFinder::error() const { return m_error; }

void FuzzyFinder::clear() {
    ++m_walkGeneration;
    ++m_scoreGeneration;

    if (!m_results.isEmpty()) {
        beginResetModel();
        m_results.clear();
        endResetModel();
        emit resultCountChanged();
    }

    m_cachedPaths.clear();
    m_cachedPaths.squeeze();
    m_searchPath.clear();
    m_query.clear();

    if (m_scanning) {
        m_scanning = false;
        emit scanningChanged();
    }
    if (m_loading) {
        m_loading = false;
        emit loadingChanged();
    }
    if (!m_error.isEmpty()) {
        m_error.clear();
        emit errorChanged();
    }
}

void FuzzyFinder::startWalk() {
    const int generation = ++m_walkGeneration;
    // Also invalidate any in-flight scoring
    ++m_scoreGeneration;

    // Clear current cache and results
    m_cachedPaths.clear();
    if (!m_results.isEmpty()) {
        beginResetModel();
        m_results.clear();
        endResetModel();
        emit resultCountChanged();
    }

    const bool hadError = !m_error.isEmpty();
    m_error.clear();

    if (m_searchPath.isEmpty()) {
        m_scanning = false;
        emit scanningChanged();
        if (hadError) emit errorChanged();
        return;
    }

    m_scanning = true;
    emit scanningChanged();
    if (hadError) emit errorChanged();

    const QString path = m_searchPath;
    const bool hidden = m_showHidden;
    const auto future = QtConcurrent::run([path, hidden]() {
        return walkDirectory(path, hidden);
    });

    auto* watcher = new QFutureWatcher<WalkResult>(this);
    connect(watcher, &QFutureWatcher<WalkResult>::finished, this,
        [this, generation, watcher]() {
            watcher->deleteLater();

            if (generation != m_walkGeneration)
                return;

            const auto result = watcher->result();

            m_cachedPaths = result.paths;
            m_scanning = false;
            emit scanningChanged();

            if (!result.error.isEmpty()) {
                m_error = result.error;
                emit errorChanged();
            }

            // Auto-score if query is already set
            if (!m_query.isEmpty())
                startScoring();
        });
    watcher->setFuture(future);
}

void FuzzyFinder::startScoring() {
    const int generation = ++m_scoreGeneration;

    if (m_query.isEmpty()) {
        if (!m_results.isEmpty()) {
            beginResetModel();
            m_results.clear();
            endResetModel();
            emit resultCountChanged();
        }
        if (m_loading) {
            m_loading = false;
            emit loadingChanged();
        }
        return;
    }

    if (m_cachedPaths.isEmpty()) {
        // Walk hasn't completed yet — query is stored, startWalk's completion
        // handler will call startScoring() when ready
        return;
    }

    m_loading = true;
    emit loadingChanged();

    const auto paths = m_cachedPaths;  // copy for thread safety
    const QString query = m_query;
    const auto future = QtConcurrent::run([paths, query]() {
        return scoreAllPaths(paths, query);
    });

    auto* watcher = new QFutureWatcher<ScorePassResult>(this);
    connect(watcher, &QFutureWatcher<ScorePassResult>::finished, this,
        [this, generation, watcher]() {
            watcher->deleteLater();

            if (generation != m_scoreGeneration)
                return;

            const auto result = watcher->result();

            beginResetModel();
            m_results = result.results;
            endResetModel();

            m_loading = false;
            emit loadingChanged();
            emit resultCountChanged();
        });
    watcher->setFuture(future);
}

} // namespace symmetria::filemanager::models
