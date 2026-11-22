'use strict';
// Where the bundled toolchain lives.
//
// xsltproc, the fop launcher and the FOP jars are real executables, so they
// cannot live inside the asar archive — electron-builder copies them out to
// resources/tools via extraResources. In a dev checkout they sit under
// server/tools-<platform> instead. Resolving that in one place keeps the two
// layouts from drifting: get it wrong and the packaged app fails at the first
// build with a confusing ENOENT on xsltproc.
//
// Everything platform-specific about the toolchain is in THIS file. FOP itself
// is pure Java and ships the same jars on every platform (only its launcher
// script differs), and none of the app's node dependencies are native, so
// porting is a matter of supplying a JRE and an xsltproc for the target and
// naming them correctly here.

const fs = require('fs');
const path = require('path');

const WIN = process.platform === 'win32';
const exe = (name) => (WIN ? `${name}.exe` : name);

/*
  Per-platform tool directories.

  The Windows set stays at server/tools, the historical location, so nothing
  about the Windows build moves. Other platforms get their own sibling
  directory, since a Windows JRE and a Linux JRE cannot share one folder.
  Packaged builds always see it as resources/tools, whichever it came from —
  electron-builder maps the right one per target.
*/
const DEV_TOOLS = path.join(__dirname, '..', WIN ? 'tools' : `tools-${process.platform}`);

function toolsRoot() {
    if (fs.existsSync(DEV_TOOLS)) return DEV_TOOLS;
    // process.resourcesPath only exists under Electron; in a packaged build the
    // tools were copied next to app.asar.
    if (process.resourcesPath) {
        const packaged = path.join(process.resourcesPath, 'tools');
        if (fs.existsSync(packaged)) return packaged;
    }
    return DEV_TOOLS; // let the caller fail with a real path in the message
}

const TOOLS = toolsRoot();

/*
  The S1000D schema sets.

  Resolved the same way as the tools, and for the same reason: a packaged build
  puts them beside app.asar rather than inside it. They cannot live INSIDE the
  archive, because both things that read them are external programs — the XML
  language server is a Java process, and Java cannot open a path inside an asar.
  A file that Node can read transparently and Java cannot is exactly the kind of
  difference that works in development and fails once installed.
*/
const DEV_SCHEMAS = path.join(__dirname, '..', '..', 'schemas');

function schemasRoot() {
    if (fs.existsSync(DEV_SCHEMAS)) return DEV_SCHEMAS;
    if (process.resourcesPath) {
        const packaged = path.join(process.resourcesPath, 'schemas');
        if (fs.existsSync(packaged)) return packaged;
    }
    return DEV_SCHEMAS;
}

const SCHEMAS = schemasRoot();

/*
  Guarantee the bundled Unix toolchain is executable.

  xsltproc, the JRE and the FOP launcher are real native programs, but they
  ship inside a directory tree that is NOT version-controlled (it is assembled
  or extracted per platform). Copying or unzipping that tree on Linux/macOS
  routinely drops the execute bit — a zip has no Unix mode, cp -r from a
  mode-666 source keeps 666, and so on — after which every spawn dies with
  EACCES and no PDF is ever produced, the failure buried in a child-process
  error. The Windows build never hits this (execution is by extension), so the
  whole concern is confined here on the one platform that has it.

  So, exactly like childEnv() repairs the AppImage linker environment, this
  repairs the file modes for the app's OWN binaries: it adds the execute bit
  to the actual executables (never the .so/.jar data files) and is a no-op
  once they are already runnable. Best-effort by design — a genuinely
  read-only install (EROFS/EPERM) is left untouched and behaves exactly as
  before, so this can never make things worse.
*/
function makeExecutable(file) {
  try {
    const st = fs.statSync(file);
    if (!st.isFile()) return;
    if ((st.mode & 0o111) === 0o111) return; // already u+x,g+x,o+x
    fs.chmodSync(file, st.mode | 0o111);
  } catch { /* missing / read-only: leave as-is */ }
}

function makeDirExecutable(dir) {
  let names;
  try { names = fs.readdirSync(dir); } catch { return; }
  for (const name of names) makeExecutable(path.join(dir, name));
}

function ensureToolchainExecutable() {
  if (WIN) return; // Windows executes by extension; nothing to fix
  // Everything the pipeline actually spawns, plus the JRE helpers Java needs
  // to launch subprocesses (jspawnhelper) — mode 666 on any of these is what
  // produces the EACCES on first build.
  makeDirExecutable(path.join(TOOLS, 'jre', 'bin'));
  for (const helper of ['jspawnhelper', 'jexec']) {
    makeExecutable(path.join(TOOLS, 'jre', 'lib', helper));
  }
  makeDirExecutable(path.join(TOOLS, 'libxslt', 'bin'));
  makeExecutable(path.join(TOOLS, 'fop-2.10', 'fop', 'fop'));
}

// Runs once, when the toolchain is first resolved, before any consumer
// (build.js, fopd.js) tries to spawn a tool.
ensureToolchainExecutable();

/*
  xsltproc.

  Shipped as a platform-named folder because the Windows build is a published
  libxslt distribution with its own versioned directory name, while other
  platforms get a directory this repo assembles. Whichever it is, the binary
  sits in bin/.
*/
const XSLTPROC_DIR = WIN
    ? path.join(TOOLS, 'libxslt-1.1.28-win32-x86')
    : path.join(TOOLS, 'libxslt');

/*
  The Java runtime FOP renders with.

  A trimmed JRE is shipped in tools/jre so the application does not depend on
  the customer having Java installed — FOP is a Java program, and without one
  every build would fail on a clean machine. Falling back to `java` on PATH
  keeps a source checkout working before the JRE has been built, and JSS_JAVA
  still overrides both for troubleshooting.
*/
const BUNDLED_JAVA = path.join(TOOLS, 'jre', 'bin', exe('java'));

function javaCmd() {
    if (process.env.JSS_JAVA) return process.env.JSS_JAVA;
    return fs.existsSync(BUNDLED_JAVA) ? BUNDLED_JAVA : 'java';
}

/*
  Ghostscript, for the optional lossless PDF recompression pass (build.js's
  applyLosslessCompression): rewrites the FOP-rendered PDF through pdfwrite
  with image downsampling/re-encoding turned off, which only strips
  redundant structure (duplicate objects, uncompressed streams) rather than
  touching pixels. Bundled as the Windows console build (gswin32c.exe); a
  Linux tools set has none yet, so hasGhostscript gates the feature off
  there rather than trying `gs` on PATH and failing unpredictably.
*/
const BUNDLED_GS = path.join(TOOLS, 'ghostscript', 'gswin32c.exe');

function gsCmd() {
    if (process.env.JSS_GS) return process.env.JSS_GS;
    return BUNDLED_GS;
}

/*
  The environment to give a spawned tool (xsltproc, java, fop).

  Inside an AppImage the runtime points LD_LIBRARY_PATH at the bundle's own
  copies of libstdc++, libz and friends so Electron can find them. Any child
  process inherits that, so the bundled JRE and xsltproc get pointed at
  Electron's libraries instead of the ones they were built against — they then
  fail to start, or die on a symbol mismatch, and the build produces nothing.

  AppImage stashes each pre-launch value in <VAR>_ORIGINAL, so the correct
  child environment is that original, or no value at all when there wasn't one.
  Only the two dynamic-linker variables are touched: they are the ones that
  break a child, and stripping more (XDG_DATA_DIRS, say) would take font
  lookup down with it.

  A no-op outside an AppImage, so Windows and a plain checkout are unaffected.
*/
const LINKER_VARS = ['LD_LIBRARY_PATH', 'LD_PRELOAD'];

function childEnv(extra) {
    const env = { ...process.env, ...(extra || {}) };
    if (process.env.APPDIR || process.env.APPIMAGE) {
        for (const v of LINKER_VARS) {
            const original = process.env[`${v}_ORIGINAL`];
            if (original !== undefined && original !== '') env[v] = original;
            else delete env[v];
        }
    }
    return env;
}

module.exports = {
    TOOLS,
    SCHEMAS,
    childEnv,
    /*
      Our FOP configuration, registering the bundled DejaVu Sans family.

      It lives at the root of the tools directory so it is found the same way on
      every platform, and it must be handed to BOTH renderers: the fop launcher
      takes it as -c, FopServer parses it itself. Give it to only one and a
      document's non-WinAnsi characters render as "#" or not depending on
      whether the warm daemon happened to be up — the kind of difference that
      looks like a random corruption bug.
    */
    FOP_XCONF: path.join(TOOLS, 'fop.xconf'),
    XSLTPROC: path.join(XSLTPROC_DIR, 'bin', exe('xsltproc')),
    // FOP's own launcher: fop.bat on Windows, the `fop` shell script elsewhere.
    // Both ship in the same FOP distribution and drive the identical jars.
    //
    // Kept only as a fallback. Prefer FOP_ARGS below: managed endpoints running
    // Trellix (or any application/script control) frequently refuse to execute a
    // .bat, and the launcher is only a thin wrapper that assembles a classpath
    // and calls java. Blocking it made the app install cleanly and then produce
    // no PDF at all, with the failure buried in a spawn error.
    FOP_BAT: path.join(TOOLS, 'fop-2.10', 'fop', WIN ? 'fop.bat' : 'fop'),

    /*
      Arguments that run FOP's CLI directly on the bundled JRE, skipping the
      launcher script entirely: java -cp "<fop>/build/*;<fop>/lib/*" <main>.

      The wildcard classpath entries are expanded by the JVM itself, not by a
      shell, so they must be passed through as single arguments and must NOT be
      quoted here.
    */
    FOP_ARGS: [
        '-cp',
        [path.join(TOOLS, 'fop-2.10', 'fop', 'build', '*'),
         path.join(TOOLS, 'fop-2.10', 'fop', 'lib', '*')].join(path.delimiter),
        'org.apache.fop.cli.Main',
    ],
    FOP_HOME: path.join(TOOLS, 'fop-2.10', 'fop'),
    JAVA: javaCmd(),
    JRE_HOME: path.join(TOOLS, 'jre'),
    hasBundledJre: fs.existsSync(BUNDLED_JAVA),
    GS: gsCmd(),
    hasGhostscript: fs.existsSync(BUNDLED_GS) || !!process.env.JSS_GS,
};
