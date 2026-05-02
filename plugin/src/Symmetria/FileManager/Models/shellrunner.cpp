#include "shellrunner.hpp"

#include <qdebug.h>

namespace symmetria::filemanager::models {

ShellRunner::ShellRunner(QObject* parent)
    : QObject(parent)
{
    connect(&m_process, &QProcess::started, this, &ShellRunner::onStarted);
    connect(&m_process, &QProcess::finished, this, &ShellRunner::onFinished);
    connect(&m_process, &QProcess::readyReadStandardOutput, this, &ShellRunner::onReadyReadStdout);
    connect(&m_process, &QProcess::readyReadStandardError, this, &ShellRunner::onReadyReadStderr);
    connect(&m_process, &QProcess::errorOccurred, this, &ShellRunner::onErrorOccurred);
}

QStringList ShellRunner::command() const { return m_command; }

void ShellRunner::setCommand(const QStringList& command)
{
    if (m_command == command)
        return;
    m_command = command;
    emit commandChanged();
}

QString ShellRunner::workingDirectory() const { return m_workingDirectory; }

void ShellRunner::setWorkingDirectory(const QString& dir)
{
    if (m_workingDirectory == dir)
        return;
    m_workingDirectory = dir;
    emit workingDirectoryChanged();
}

QVariantMap ShellRunner::environment() const { return m_environment; }

void ShellRunner::setEnvironment(const QVariantMap& environment)
{
    if (m_environment == environment)
        return;
    m_environment = environment;
    emit environmentChanged();
}

bool ShellRunner::running() const { return m_running; }
QString ShellRunner::stdoutText() const { return m_stdoutText; }
QString ShellRunner::stderrText() const { return m_stderrText; }
int ShellRunner::exitCode() const { return m_exitCode; }

void ShellRunner::start()
{
    if (m_running) {
        qWarning() << "ShellRunner::start() called while already running, ignoring";
        return;
    }
    if (m_command.isEmpty()) {
        qWarning() << "ShellRunner::start() called with empty command";
        emit errorOccurred(QStringLiteral("command is empty"));
        return;
    }

    m_stdoutText.clear();
    m_stderrText.clear();
    m_exitCode = 0;
    emit stdoutTextChanged();
    emit stderrTextChanged();

    if (!m_workingDirectory.isEmpty())
        m_process.setWorkingDirectory(m_workingDirectory);

    if (!m_environment.isEmpty()) {
        QProcessEnvironment env = QProcessEnvironment::systemEnvironment();
        for (auto it = m_environment.constBegin(); it != m_environment.constEnd(); ++it)
            env.insert(it.key(), it.value().toString());
        m_process.setProcessEnvironment(env);
    }

    const QString program = m_command.first();
    const QStringList args = m_command.mid(1);
    m_process.start(program, args);
}

void ShellRunner::terminate()
{
    if (m_running)
        m_process.terminate();
}

void ShellRunner::kill()
{
    if (m_running)
        m_process.kill();
}

void ShellRunner::write(const QString& data)
{
    if (!m_running) {
        qWarning() << "ShellRunner::write() called while not running";
        return;
    }
    m_process.write(data.toUtf8());
}

void ShellRunner::closeWriteChannel()
{
    if (m_running)
        m_process.closeWriteChannel();
}

void ShellRunner::onStarted()
{
    m_running = true;
    emit runningChanged();
    emit started();
}

void ShellRunner::onFinished(int code, QProcess::ExitStatus status)
{
    m_running = false;
    m_exitCode = code;
    emit runningChanged();
    emit exited(code, static_cast<int>(status));
}

void ShellRunner::onReadyReadStdout()
{
    const QByteArray chunk = m_process.readAllStandardOutput();
    if (chunk.isEmpty())
        return;
    m_stdoutText.append(QString::fromUtf8(chunk));
    emit stdoutTextChanged();
}

void ShellRunner::onReadyReadStderr()
{
    const QByteArray chunk = m_process.readAllStandardError();
    if (chunk.isEmpty())
        return;
    m_stderrText.append(QString::fromUtf8(chunk));
    emit stderrTextChanged();
}

void ShellRunner::onErrorOccurred(QProcess::ProcessError error)
{
    emit errorOccurred(m_process.errorString());
    // FailedToStart fires before started(); keep state consistent.
    if (error == QProcess::FailedToStart && m_running) {
        m_running = false;
        emit runningChanged();
    }
}

} // namespace symmetria::filemanager::models
