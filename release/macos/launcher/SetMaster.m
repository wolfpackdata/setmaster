/*
 * SetMaster.app launcher (#214)
 *
 * The .command launchers start uvicorn detached and exit, leaving a headless
 * server that a second script has to stop. That is fine for a folder of
 * scripts; inside an app dragged to /Applications it means the icon bounces,
 * vanishes, and leaves a server running with no visible way to quit it.
 *
 * So the app owns the server's lifetime: it stays in the Dock while SetMaster
 * is up, and Quit shuts the backend down. That needs an NSApplication - a
 * shell script cannot hold a Dock icon or receive Cmd-Q - which is why this is
 * a compiled binary rather than a wrapper around the existing .command.
 *
 * Deliberately does NOT adopt a server it did not start. If something is
 * already serving on the port (a dev checkout, a stale process), the app opens
 * the browser and leaves that process completely alone, including on quit.
 * Killing a process merely for owning a port is the #181 mistake.
 *
 * Logs go to ~/Library/Logs/SetMaster3/, never inside the bundle: writing into
 * a signed .app modifies sealed contents and breaks the signature on first
 * launch.
 *
 * Build: clang -fobjc-arc -framework Cocoa -mmacosx-version-min=11.0
 */

#import <Cocoa/Cocoa.h>
#include <signal.h>

static NSString *const kDisplayName = @"SetMaster";
static const int kDefaultPort = 8137;
static const NSTimeInterval kStartupTimeout = 45.0;
static const NSTimeInterval kProbeTimeout = 2.0;
static const NSTimeInterval kQuitGrace = 5.0;

@interface AppDelegate : NSObject <NSApplicationDelegate>
@property(nonatomic, strong) NSTask *server;
@property(nonatomic, assign) int port;
@property(nonatomic, strong) NSURL *url;
@property(nonatomic, assign) BOOL weStartedIt;
@end

@implementation AppDelegate

#pragma mark - Paths

/* Payload root inside the bundle. Mirrors the .tar.gz layout exactly
 * (backend/, frontend/dist/, runtime/python/) so backend/app/main.py's
 * parents[2] resolution to frontend/dist keeps working unchanged. */
- (NSString *)payloadRoot {
    return [[[NSBundle mainBundle] resourcePath] stringByAppendingPathComponent:@"app"];
}

- (NSString *)pythonPath {
    return [[self payloadRoot] stringByAppendingPathComponent:@"runtime/python/bin/python3"];
}

- (NSString *)backendDir {
    return [[self payloadRoot] stringByAppendingPathComponent:@"backend"];
}

- (NSString *)logPath {
    NSString *dir = [NSHomeDirectory()
        stringByAppendingPathComponent:@"Library/Logs/SetMaster3"];
    [[NSFileManager defaultManager] createDirectoryAtPath:dir
                              withIntermediateDirectories:YES
                                               attributes:nil
                                                    error:NULL];
    return [dir stringByAppendingPathComponent:
                    [NSString stringWithFormat:@"setmaster3-%d.log", self.port]];
}

#pragma mark - Readiness

/* True only when SetMaster itself answers - not merely "something holds the
 * port". Same contract as the .command launcher's ready(). */
- (BOOL)serverIsReady {
    NSURL *status = [NSURL URLWithString:
        [NSString stringWithFormat:@"http://127.0.0.1:%d/api/status", self.port]];
    NSMutableURLRequest *req = [NSMutableURLRequest requestWithURL:status];
    req.timeoutInterval = kProbeTimeout;
    req.cachePolicy = NSURLRequestReloadIgnoringLocalAndRemoteCacheData;

    __block BOOL ok = NO;
    dispatch_semaphore_t done = dispatch_semaphore_create(0);
    NSURLSessionDataTask *task = [[NSURLSession sharedSession]
        dataTaskWithRequest:req
          completionHandler:^(NSData *data, NSURLResponse *resp, NSError *err) {
              (void)resp;
              if (!err && data.length > 0) {
                  NSString *body = [[NSString alloc] initWithData:data
                                                         encoding:NSUTF8StringEncoding];
                  ok = [body containsString:@"app_version"];
              }
              dispatch_semaphore_signal(done);
          }];
    [task resume];
    dispatch_semaphore_wait(done,
        dispatch_time(DISPATCH_TIME_NOW, (int64_t)((kProbeTimeout + 1.0) * NSEC_PER_SEC)));
    return ok;
}

#pragma mark - Lifecycle

- (void)applicationDidFinishLaunching:(NSNotification *)note {
    self.port = kDefaultPort;
    NSString *envPort = NSProcessInfo.processInfo.environment[@"SM3_PORT"];
    if (envPort.intValue > 0) self.port = envPort.intValue;
    self.url = [NSURL URLWithString:
        [NSString stringWithFormat:@"http://127.0.0.1:%d/", self.port]];

    [self buildMenu];

    // Already serving? Attach without spawning, and never claim ownership.
    if ([self serverIsReady]) {
        self.weStartedIt = NO;
        [self openBrowser];
        return;
    }

    NSFileManager *fm = [NSFileManager defaultManager];
    if (![fm isExecutableFileAtPath:[self pythonPath]]) {
        [self failWith:@"SetMaster is not fully installed - its bundled Python is "
                        "missing. Please reinstall SetMaster from the disk image."];
        return;
    }

    if (![self startServer]) return;
    [self waitForReadyThenOpen];
}

- (BOOL)startServer {
    NSString *log = [self logPath];
    if (![[NSFileManager defaultManager] fileExistsAtPath:log]) {
        [[NSFileManager defaultManager] createFileAtPath:log contents:nil attributes:nil];
    }
    NSFileHandle *handle = [NSFileHandle fileHandleForWritingAtPath:log];
    [handle seekToEndOfFile];

    NSTask *task = [[NSTask alloc] init];
    task.executableURL = [NSURL fileURLWithPath:[self pythonPath]];
    task.arguments = @[ @"-m", @"uvicorn", @"app.main:app",
                        @"--host", @"127.0.0.1",
                        @"--port", [NSString stringWithFormat:@"%d", self.port] ];
    task.currentDirectoryURL = [NSURL fileURLWithPath:[self backendDir]];
    task.standardOutput = handle;
    task.standardError = handle;

    /* Belt and braces with the build's pre-compile step. Anything not already
     * sealed as .pyc must compile in memory rather than being written into the
     * bundle: a single stray .pyc invalidates the code signature, and macOS
     * then refuses to launch the app it just accepted. */
    NSMutableDictionary *env =
        [NSProcessInfo.processInfo.environment mutableCopy];
    env[@"PYTHONDONTWRITEBYTECODE"] = @"1";
    task.environment = env;

    NSError *err = nil;
    if (![task launchAndReturnError:&err]) {
        [self failWith:[NSString stringWithFormat:
            @"SetMaster's backend could not be started.\n\n%@", err.localizedDescription]];
        return NO;
    }
    self.server = task;
    self.weStartedIt = YES;
    return YES;
}

- (void)waitForReadyThenOpen {
    dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0), ^{
        NSDate *deadline = [NSDate dateWithTimeIntervalSinceNow:kStartupTimeout];
        while ([deadline timeIntervalSinceNow] > 0) {
            if (!self.server.isRunning) {
                dispatch_async(dispatch_get_main_queue(), ^{
                    [self failWith:[NSString stringWithFormat:
                        @"SetMaster's backend stopped unexpectedly during startup.\n\n"
                         "The log is at:\n%@", [self logPath]]];
                });
                return;
            }
            if ([self serverIsReady]) {
                dispatch_async(dispatch_get_main_queue(), ^{ [self openBrowser]; });
                return;
            }
            [NSThread sleepForTimeInterval:0.4];
        }
        dispatch_async(dispatch_get_main_queue(), ^{
            [self failWith:[NSString stringWithFormat:
                @"SetMaster's backend did not start within %d seconds.\n\n"
                 "The log is at:\n%@", (int)kStartupTimeout, [self logPath]]];
        });
    });
}

- (void)openBrowser {
    [[NSWorkspace sharedWorkspace] openURL:self.url];
}

/* Clicking the Dock icon while running re-opens the browser tab. Without this
 * a user who closed the tab has a running app and no way back to it. */
- (BOOL)applicationShouldHandleReopen:(NSApplication *)sender
                    hasVisibleWindows:(BOOL)flag {
    [self openBrowser];
    return YES;
}

- (void)applicationWillTerminate:(NSNotification *)note {
    [self stopServer];
}

- (void)stopServer {
    if (!self.weStartedIt || !self.server || !self.server.isRunning) return;

    pid_t pid = self.server.processIdentifier;
    kill(pid, SIGTERM);

    NSDate *deadline = [NSDate dateWithTimeIntervalSinceNow:kQuitGrace];
    while (self.server.isRunning && [deadline timeIntervalSinceNow] > 0) {
        [NSThread sleepForTimeInterval:0.1];
    }
    if (self.server.isRunning) kill(pid, SIGKILL);
}

- (void)failWith:(NSString *)message {
    NSAlert *alert = [[NSAlert alloc] init];
    alert.alertStyle = NSAlertStyleCritical;
    alert.messageText = kDisplayName;
    alert.informativeText = message;
    [alert addButtonWithTitle:@"OK"];
    [NSApp activateIgnoringOtherApps:YES];
    [alert runModal];
    [NSApp terminate:nil];
}

#pragma mark - Menu

/* Built in code because the bundle carries no nib - one less resource to sign
 * and keep in sync. */
- (void)buildMenu {
    NSMenu *bar = [[NSMenu alloc] init];
    NSMenuItem *appItem = [[NSMenuItem alloc] init];
    [bar addItem:appItem];
    [NSApp setMainMenu:bar];

    NSMenu *appMenu = [[NSMenu alloc] init];

    NSMenuItem *open = [[NSMenuItem alloc]
        initWithTitle:[NSString stringWithFormat:@"Open %@", kDisplayName]
               action:@selector(openBrowser)
        keyEquivalent:@"o"];
    open.target = self;
    [appMenu addItem:open];

    [appMenu addItem:[NSMenuItem separatorItem]];

    NSMenuItem *hide = [[NSMenuItem alloc]
        initWithTitle:[NSString stringWithFormat:@"Hide %@", kDisplayName]
               action:@selector(hide:)
        keyEquivalent:@"h"];
    [appMenu addItem:hide];

    [appMenu addItem:[NSMenuItem separatorItem]];

    NSMenuItem *quit = [[NSMenuItem alloc]
        initWithTitle:[NSString stringWithFormat:@"Quit %@", kDisplayName]
               action:@selector(terminate:)
        keyEquivalent:@"q"];
    [appMenu addItem:quit];

    appItem.submenu = appMenu;
}

@end

int main(int argc, const char *argv[]) {
    (void)argc;
    (void)argv;
    @autoreleasepool {
        NSApplication *app = [NSApplication sharedApplication];
        [app setActivationPolicy:NSApplicationActivationPolicyRegular];
        // NSApplication holds its delegate weakly; a local would be released.
        static AppDelegate *delegate;
        delegate = [[AppDelegate alloc] init];
        app.delegate = delegate;
        [app run];
    }
    return 0;
}
