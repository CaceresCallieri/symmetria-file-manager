// ShellRunnerTest — unit tests for the QProcess-wrapping QML element.
//
// Uses QTEST_MAIN (with QGuiApplication via QT_QPA_PLATFORM=offscreen) so the
// QProcess child can spawn under any test environment. Commands are limited
// to /usr/bin/env, /bin/echo, /bin/cat, /bin/sh — present on every Arch /
// CI box.

#include "shellrunner.hpp"

#include <QSignalSpy>
#include <QTest>

using namespace symmetria::filemanager::models;

class ShellRunnerTest : public QObject {
    Q_OBJECT

private:
    // Wait for the spy to have at least one signal. If it already does, returns
    // immediately. Set up the spy BEFORE calling start() — QProcess fires
    // exited() asynchronously on the next event-loop tick, so a state-flag
    // check (running()) right after start() is racy and unreliable.
    static bool waitForSpy(QSignalSpy& spy, int timeout = 5000)
    {
        if (spy.count() > 0)
            return true;
        return spy.wait(timeout);
    }

private slots:
    void echoCapturesStdout()
    {
        ShellRunner runner;
        runner.setCommand({"/bin/echo", "hello world"});

        QSignalSpy startedSpy(&runner, &ShellRunner::started);
        QSignalSpy exitedSpy(&runner, &ShellRunner::exited);

        runner.start();
        QVERIFY(waitForSpy(exitedSpy));
        QCOMPARE(exitedSpy.count(), 1);
        QCOMPARE(startedSpy.count(), 1);

        const QList<QVariant> args = exitedSpy.first();
        QCOMPARE(args.at(0).toInt(), 0);  // exit code 0
        QVERIFY(runner.stdoutText().contains("hello world"));
    }

    void exitCodePropagated()
    {
        ShellRunner runner;
        runner.setCommand({"/bin/sh", "-c", "exit 42"});

        QSignalSpy exitedSpy(&runner, &ShellRunner::exited);
        runner.start();
        QVERIFY(waitForSpy(exitedSpy));

        QCOMPARE(runner.exitCode(), 42);
        QCOMPARE(runner.running(), false);
    }

    void stderrCaptured()
    {
        ShellRunner runner;
        runner.setCommand({"/bin/sh", "-c", "echo errstream 1>&2"});

        QSignalSpy exitedSpy(&runner, &ShellRunner::exited);
        runner.start();
        QVERIFY(waitForSpy(exitedSpy));

        QVERIFY(runner.stderrText().contains("errstream"));
        QVERIFY(runner.stdoutText().isEmpty());
    }

    void writeAndCloseChannel()
    {
        // cat reads stdin, writes to stdout, exits when stdin closes.
        ShellRunner runner;
        runner.setCommand({"/bin/cat"});

        QSignalSpy startedSpy(&runner, &ShellRunner::started);
        QSignalSpy exitedSpy(&runner, &ShellRunner::exited);
        runner.start();

        // Wait for the process to actually start before writing.
        QVERIFY(waitForSpy(startedSpy));

        runner.write(QStringLiteral("payload\n"));
        runner.closeWriteChannel();

        QVERIFY(waitForSpy(exitedSpy));
        QVERIFY(runner.stdoutText().contains("payload"));
    }

    void doubleStartIsNoOp()
    {
        // Starting while already running should log a warning and not start
        // a second process. We can't easily observe the warning, but we can
        // assert the second start() doesn't break the first run.
        ShellRunner runner;
        runner.setCommand({"/bin/sh", "-c", "sleep 0.1"});

        QSignalSpy startedSpy(&runner, &ShellRunner::started);
        QSignalSpy exitedSpy(&runner, &ShellRunner::exited);
        runner.start();
        QVERIFY(waitForSpy(startedSpy));
        // Now actually running — second start should be a no-op.
        runner.start();
        QVERIFY(waitForSpy(exitedSpy));
        QCOMPARE(startedSpy.count(), 1);
        QCOMPARE(exitedSpy.count(), 1);
        QCOMPARE(runner.running(), false);
    }

    void emptyCommandEmitsErrorWithoutCrash()
    {
        ShellRunner runner;
        QSignalSpy errorSpy(&runner, &ShellRunner::errorOccurred);
        runner.start();  // no command set
        QCOMPARE(errorSpy.count(), 1);
        QCOMPARE(runner.running(), false);
    }

    void environmentMergesOverInherited()
    {
        // Inherited env has PATH, etc. The override adds SYMMETRIA_TEST_VAR.
        // We verify via /bin/sh -c "echo $SYMMETRIA_TEST_VAR".
        ShellRunner runner;
        runner.setCommand({"/bin/sh", "-c", "echo $SYMMETRIA_TEST_VAR"});
        QVariantMap env;
        env.insert("SYMMETRIA_TEST_VAR", "marker_xyz");
        runner.setEnvironment(env);

        QSignalSpy exitedSpy(&runner, &ShellRunner::exited);
        runner.start();
        QVERIFY(waitForSpy(exitedSpy));

        QVERIFY(runner.stdoutText().contains("marker_xyz"));
    }

    void rerunAfterExitClearsBuffers()
    {
        ShellRunner runner;
        runner.setCommand({"/bin/echo", "first"});

        QSignalSpy firstExitedSpy(&runner, &ShellRunner::exited);
        runner.start();
        QVERIFY(waitForSpy(firstExitedSpy));
        QVERIFY(runner.stdoutText().contains("first"));

        runner.setCommand({"/bin/echo", "second"});
        QSignalSpy secondExitedSpy(&runner, &ShellRunner::exited);
        runner.start();
        QVERIFY(waitForSpy(secondExitedSpy));

        // Buffer should reset between runs (start() clears it).
        QVERIFY(runner.stdoutText().contains("second"));
        QVERIFY(!runner.stdoutText().contains("first"));
    }

    void terminateWhileRunningStopsProcess()
    {
        ShellRunner runner;
        runner.setCommand({"/bin/sh", "-c", "sleep 5"});

        QSignalSpy startedSpy(&runner, &ShellRunner::started);
        QSignalSpy exitedSpy(&runner, &ShellRunner::exited);
        runner.start();
        QVERIFY(waitForSpy(startedSpy));
        QVERIFY(runner.running());

        runner.terminate();
        QVERIFY(waitForSpy(exitedSpy, 3000));
        QCOMPARE(runner.running(), false);
    }
};

QTEST_MAIN(ShellRunnerTest)
#include "ShellRunnerTest.moc"
