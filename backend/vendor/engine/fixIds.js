'use strict';
/*
  Make every @id in a project's data modules unique across the whole CSDB, and
  repoint the references that target them.

  WHY THIS EXISTS

  S1000D requires an @id to be unique only WITHIN one data module, so every
  module authored by a tool like Xignal numbers its own figures from "fig-0001".
  That is entirely legal, and entirely fine until a publication binds the
  modules together: both build pipelines merge every module into ONE XML
  document (xsltproc --xinclude) before the stylesheets run, and at that point
  the ids collide. Measured on a real workspace: "fig-0001" occurring 510 times,
  "tbl-001" 218 times.

  The stylesheets survive it — they must, because FOP treats a duplicate id as a
  fatal error — by letting the FIRST element in the book keep the authored id
  and giving later ones a suffix. The cost is paid by references: an
  <internalRef internalRefId="fig-0001"/> in chapter 9 is LABELLED from its own
  module ("Figure 9-3", correct) but LINKS to the bare id, which resolves to
  chapter 1's figure. A reader clicking it lands in the wrong module. A wrong
  link is worse than a broken one, because nothing looks wrong.

  This module fixes it at the source instead, on demand, from the Validation
  page — so the XML a project holds is unambiguous no matter which pipeline,
  stylesheet or external tool reads it next.

  WHAT IT DOES

  Every id in a data module gains a short prefix derived from that module's own
  dmCode: "fig-0001" becomes e.g. "dmk3f9q2-fig-0001". The prefix is:

    - deterministic — the same dmCode always hashes to the same prefix, so two
      runs produce identical output and a re-run is a no-op;
    - idempotent — an id already carrying a prefix has it stripped and
      recomputed, so re-running after a module is re-coded corrects it rather
      than stacking a second prefix;
    - a valid XML NCName — always starts with a letter, so the result is still
      schema-valid as an xsd:ID.

  References are repointed in the same pass:

    - internalRefId  — DM-local by specification, so it takes its own module's
                       prefix.
    - applicRefId    — likewise DM-local (it targets an <applic> in the
                       module's own referencedApplicGroup).
    - referredFragment on <dmRef> — the one genuinely CROSS-module reference.
                       It takes the prefix of the module the sibling
                       <dmRefIdent><dmCode> names, resolved through the
                       project-wide dmCode index.

  WHAT IT DELIBERATELY DOES NOT DO

  The publication module is never touched. Its ids are a different namespace
  and some of them are RESERVED VALUES the stylesheets compare literally —
  <pmEntry id="a3-landscape">, "a4-landscape", "landscape" select a page
  master (s1000dtofo/figures.xsl, s1000dtojss.xsl). Prefixing those would
  silently change every landscape figure back to portrait.

  A reference whose target does not exist in its own module is LEFT EXACTLY AS
  WRITTEN and reported instead. It is already broken; guessing at which module
  was meant would turn a visible fault into an invisible one.
*/

const fs = require('fs');
const path = require('path');
const { parseAttrs, dmCodeString } = require('./resolveDmRefs');

// Attributes that hold a reference to an @id declared in the SAME data module.
// Kept as a list rather than a regex alternation because it is read far more
// often than it is matched against.
const LOCAL_REF_ATTRS = ['internalRefId', 'applicRefId'];

/*
  The prefix for one data module.

  FNV-1a over the canonical dmCode string, rendered base36. Six base36 digits
  is ~2.2e9 values — for the hundred-odd modules in a publication the chance of
  two colliding is negligible, and planFixIds checks for it anyway rather than
  trusting the arithmetic.

  "dm" leads so the result always starts with a letter: an xsd:ID is an NCName,
  and a base36 hash can perfectly well start with a digit.
*/
function prefixFor(dmCode) {
    let h = 0x811c9dc5;
    for (let i = 0; i < dmCode.length; i++) {
        h ^= dmCode.charCodeAt(i);
        // FNV prime, via shifts — Math.imul keeps this in 32-bit territory
        // instead of drifting into float once the product exceeds 2^53.
        h = Math.imul(h, 0x01000193) >>> 0;
    }
    return 'dm' + h.toString(36).padStart(6, '0').slice(-6);
}

// A prefix this module previously applied. Stripped before a new one is added
// so re-running is idempotent and a re-coded module is corrected rather than
// double-prefixed.
const PREFIX_RE = /^dm[0-9a-z]{6}-/;

function stripPrefix(id) {
    return id.replace(PREFIX_RE, '');
}

function applyPrefix(prefix, id) {
    return prefix + '-' + stripPrefix(id);
}

/*
  Walk a document's TAGS, handing each one to `fn` for rewriting, and leave
  everything else — text, comments, CDATA, the DOCTYPE, processing
  instructions — byte-identical.

  Doing it this way rather than with a global attribute regex matters: a
  procedure's prose routinely quotes an id ('set the switch to "fig-0001"'), a
  comment often holds a comment-out of the very markup being edited, and an
  internal DTD subset declares entities with quoted values. Rewriting any of
  those would be a silent content change.
*/
function rewriteTags(xml, fn) {
    let out = '';
    let i = 0;
    while (i < xml.length) {
        const lt = xml.indexOf('<', i);
        if (lt < 0) { out += xml.slice(i); break; }
        out += xml.slice(i, lt);

        // Skippable constructs, each with its own terminator.
        if (xml.startsWith('<!--', lt)) {
            const end = xml.indexOf('-->', lt + 4);
            const stop = end < 0 ? xml.length : end + 3;
            out += xml.slice(lt, stop); i = stop; continue;
        }
        if (xml.startsWith('<![CDATA[', lt)) {
            const end = xml.indexOf(']]>', lt + 9);
            const stop = end < 0 ? xml.length : end + 3;
            out += xml.slice(lt, stop); i = stop; continue;
        }
        if (xml.startsWith('<?', lt)) {
            const end = xml.indexOf('?>', lt + 2);
            const stop = end < 0 ? xml.length : end + 2;
            out += xml.slice(lt, stop); i = stop; continue;
        }
        if (xml.startsWith('<!', lt)) {
            // DOCTYPE, possibly with an internal subset whose ']' must be
            // passed before the closing '>' counts.
            let j = lt + 2, depth = 0;
            for (; j < xml.length; j++) {
                const c = xml[j];
                if (c === '[') depth++;
                else if (c === ']') depth--;
                else if (c === '>' && depth <= 0) { j++; break; }
            }
            out += xml.slice(lt, j); i = j; continue;
        }

        // An ordinary tag. Find its '>' without stopping inside an attribute
        // value, since a value may legitimately contain '>'.
        let j = lt + 1, quote = null;
        for (; j < xml.length; j++) {
            const c = xml[j];
            if (quote) { if (c === quote) quote = null; continue; }
            if (c === '"' || c === "'") { quote = c; continue; }
            if (c === '>') { j++; break; }
        }
        const tag = xml.slice(lt, j);
        out += fn(tag);
        i = j;
    }
    return out;
}

// The tag's element name — for a CLOSING tag too, which is what lets the
// dmRef-depth counters below pair up. Callers test `closing` separately when
// they care; a closing tag carries no attributes and is never rewritten.
function tagName(tag) {
    const m = /^<\s*\/?\s*([\w.:-]+)/.exec(tag);
    return m ? m[1] : '';
}

// Replace one attribute's value in a raw tag, leaving spacing and attribute
// order exactly as authored — a diff of this change should show only the ids.
function setAttr(tag, name, value) {
    const re = new RegExp('(\\b' + name + '\\s*=\\s*")([^"]*)(")');
    return tag.replace(re, (_m, a, _old, c) => a + value + c);
}

function getAttr(tag, name) {
    const m = new RegExp('\\b' + name + '\\s*=\\s*"([^"]*)"').exec(tag);
    return m ? m[1] : null;
}

/*
  Read one data module: its own dmCode, every @id it declares, and every
  reference it makes.

  The whole file is read (unlike readOwnDmCode's bounded head-read elsewhere in
  this engine) because ids live throughout the content, not in the header.
*/
function scanModule(absPath) {
    const xml = fs.readFileSync(absPath, 'utf8');
    const ids = new Set();
    const localRefs = [];
    const fragmentRefs = [];

    // dmCode from the module's own identAndStatusSection.
    let dmCode = null;
    const identSection = /<dmIdent>([\s\S]*?)<\/dmIdent>/.exec(xml);
    if (identSection) {
        const codeTag = /<dmCode\b([^>]*)\/>/.exec(identSection[1]);
        if (codeTag) {
            const extTag = /<identExtension\b([^>]*)\/>/.exec(identSection[1]);
            dmCode = dmCodeString(parseAttrs(codeTag[1]), extTag ? parseAttrs(extTag[1]) : null);
        }
    }

    /*
      <dmRef> holds a dmCode of its own, and that dmCode is the TARGET's, not
      this module's. Tracking whether we are inside a dmRef keeps this module's
      own ids and refs from being confused by one, and lets a referredFragment
      be paired with the dmCode that names the module it points into.

      Every dmRef that carries a referredFragment is recorded the moment its
      OPENING tag is seen — before the target is known — and its targetCode is
      filled in when the dmCode arrives. Recording it up front is what lets
      rewriteModule walk the same list in the same order: a malformed dmRef
      that never supplies a dmCode keeps its place (with a null targetCode)
      instead of shifting every later reference by one.
    */
    let dmRefDepth = 0;
    let openFragment = null;

    rewriteTags(xml, (tag) => {
        const name = tagName(tag);
        const closing = /^<\s*\//.test(tag);
        const selfClosing = /\/\s*>$/.test(tag);

        if (name === 'dmRef') {
            if (closing) { dmRefDepth = Math.max(0, dmRefDepth - 1); openFragment = null; }
            else {
                const frag = getAttr(tag, 'referredFragment');
                if (frag) {
                    const entry = { fragment: frag, targetCode: null };
                    fragmentRefs.push(entry);
                    openFragment = selfClosing ? null : entry;
                }
                if (!selfClosing) dmRefDepth++;
            }
            return tag;
        }
        if (closing) return tag;

        if (dmRefDepth > 0 && name === 'dmCode' && openFragment) {
            openFragment.targetCode = dmCodeString(parseAttrs(tag), null);
            openFragment = null;
            return tag;
        }

        const id = getAttr(tag, 'id');
        // An @id inside a <dmRef> would belong to the reference, not to this
        // module's content — there is no such attribute in S1000D, but the
        // guard costs nothing and keeps the rule stated.
        if (id && dmRefDepth === 0) ids.add(id);

        for (const attr of LOCAL_REF_ATTRS) {
            const v = getAttr(tag, attr);
            if (v) localRefs.push({ attr, value: v });
        }
        return tag;
    });

    return { xml, dmCode, ids, localRefs, fragmentRefs };
}

/*
  Plan the change across the whole CSDB without writing anything.

  Returns everything the UI needs to describe the operation before it happens
  and to report it afterwards, including the problems it will NOT fix.
*/
function planFixIds(csdbAbsDir) {
    const files = fs.existsSync(csdbAbsDir)
        ? fs.readdirSync(csdbAbsDir).filter((f) => /^DMC-.*\.xml$/i.test(f)).sort()
        : [];

    const modules = [];
    // dmCode -> { prefix, ids } for that module. The ids are carried too so a
    // cross-module referredFragment can be checked against what the target
    // actually declares, not merely against the module existing.
    const byCode = new Map();
    const prefixOwner = new Map();// prefix  -> dmCode, to detect a hash collision
    const skipped = [];

    for (const file of files) {
        const abs = path.join(csdbAbsDir, file);
        let m;
        try { m = scanModule(abs); }
        catch (e) { skipped.push({ file, reason: e.message }); continue; }
        if (!m.dmCode) { skipped.push({ file, reason: 'no dmCode in identAndStatusSection' }); continue; }

        let prefix = prefixFor(m.dmCode);
        /*
          Two different modules hashing to the same prefix would reintroduce
          the very collision this is here to remove. Astronomically unlikely,
          and cheap to rule out: walk a counter into the hashed string until
          the prefix is free. Still deterministic, because the file list is
          sorted and the search is ordered.
        */
        for (let n = 1; prefixOwner.has(prefix) && prefixOwner.get(prefix) !== m.dmCode; n++) {
            prefix = prefixFor(m.dmCode + '#' + n);
        }
        prefixOwner.set(prefix, m.dmCode);
        byCode.set(m.dmCode, { prefix, ids: new Set([...m.ids].map(stripPrefix)) });
        modules.push({ file, abs, prefix, ...m });
    }

    /*
      Which ids are actually shared between modules — the reason to run this at
      all, and what the Validation report shows.

      Compared AS WRITTEN, not stripped of any prefix: once two modules carry
      "dmk3f9q2-fig-0001" and "dmcy50z7-fig-0001" they genuinely do not collide,
      and reporting the bare "fig-0001" underneath them would leave the report
      permanently complaining about a fault that has been fixed.
    */
    const seen = new Map(); // id -> [file, ...]
    for (const m of modules) {
        for (const id of m.ids) {
            if (!seen.has(id)) seen.set(id, []);
            seen.get(id).push(m.file);
        }
    }
    const collisions = [...seen.entries()]
        .filter(([, where]) => where.length > 1)
        .map(([id, where]) => ({ id, count: where.length, files: where }))
        .sort((a, b) => b.count - a.count || a.id.localeCompare(b.id));

    // Per-file edits, plus the references this cannot honour.
    const plan = [];
    const danglingLocal = [];
    const unresolvedFragments = [];

    for (const m of modules) {
        const bareIds = new Set([...m.ids].map(stripPrefix));
        let idCount = 0, refCount = 0, fragCount = 0;

        /*
          Counted only when the value would actually CHANGE, not merely when it
          resolves. Counting every resolving reference left an already-fixed
          project reporting work still to do, so the Validation page offered a
          repair for a fault that was no longer there and the run could never
          settle.
        */
        for (const r of m.localRefs) {
            if (!bareIds.has(stripPrefix(r.value))) {
                danglingLocal.push({ file: m.file, attr: r.attr, value: r.value });
            } else if (applyPrefix(m.prefix, r.value) !== r.value) refCount++;
        }
        for (const fr of m.fragmentRefs) {
            const target = fr.targetCode ? byCode.get(fr.targetCode) : null;
            // Unresolvable either because this project does not hold the target
            // module, or because that module declares no such id. Both leave a
            // link that already points at nothing, so both are reported rather
            // than dressed up with a prefix.
            if (!target || !target.ids.has(stripPrefix(fr.fragment))) {
                unresolvedFragments.push({ file: m.file, fragment: fr.fragment, targetCode: fr.targetCode });
            } else if (applyPrefix(target.prefix, fr.fragment) !== fr.fragment) fragCount++;
        }
        for (const id of m.ids) {
            if (applyPrefix(m.prefix, id) !== id) idCount++;
        }

        if (idCount || refCount || fragCount) {
            plan.push({ file: m.file, prefix: m.prefix, ids: idCount, refs: refCount, fragments: fragCount });
        }
    }

    return {
        modules: modules.length,
        files: files.length,
        skipped,
        collisions,
        plan,
        danglingLocal,
        unresolvedFragments,
        totals: {
            ids: plan.reduce((a, p) => a + p.ids, 0),
            refs: plan.reduce((a, p) => a + p.refs, 0),
            fragments: plan.reduce((a, p) => a + p.fragments, 0),
            filesChanged: plan.length,
        },
        // The scan itself, so a caller that goes on to APPLY the plan can hand
        // each module straight to rewriteModule instead of reading every file a
        // second time. Underscored because it is internal to that handoff and
        // must not be serialised into an API response.
        _modules: modules,
        _byCode: byCode,
    };
}

/*
  Produce the rewritten text for one module. Pure — it takes what scanModule
  already read and returns a string, so the caller decides whether to write it.
*/
function rewriteModule(mod, byCode) {
    const bareIds = new Set([...mod.ids].map(stripPrefix));
    let dmRefDepth = 0;

    /*
      A referredFragment names an id in ANOTHER module, and the <dmRefIdent>
      <dmCode> saying WHICH module sits inside the same <dmRef>, after the
      attribute that needs it. Rather than hold the tag back and patch it up
      later, the targets come from scanModule's fragmentRefs, which recorded
      them in document order during the read — so each dmRef carrying a
      fragment is rewritten in place, on sight, from the entry at the matching
      position in that list.
    */
    const fragments = mod.fragmentRefs || [];
    let fragmentAt = 0;

    return rewriteTags(mod.xml, (tag) => {
        const name = tagName(tag);
        const closing = /^<\s*\//.test(tag);
        const selfClosing = /\/\s*>$/.test(tag);

        if (name === 'dmRef') {
            if (closing) { dmRefDepth = Math.max(0, dmRefDepth - 1); return tag; }
            let out = tag;
            if (getAttr(tag, 'referredFragment')) {
                const entry = fragments[fragmentAt++];
                const target = entry && entry.targetCode ? byCode.get(entry.targetCode) : null;
                /*
                  Rewritten only when the target module is in this project AND
                  actually declares the id. Otherwise the reference already
                  points at nothing, and prefixing it would dress a broken link
                  up as a plausible one.
                */
                if (target && target.ids.has(stripPrefix(entry.fragment))) {
                    out = setAttr(out, 'referredFragment', applyPrefix(target.prefix, entry.fragment));
                }
            }
            if (!selfClosing) dmRefDepth++;
            return out;
        }

        if (closing) return tag;
        /*
          Inside a <dmRef> every attribute describes the module being referred
          to, not this one: its dmCode is the target's identity and holds no id
          of ours to rename.
        */
        if (dmRefDepth > 0) return tag;

        let out = tag;
        const id = getAttr(out, 'id');
        if (id) out = setAttr(out, 'id', applyPrefix(mod.prefix, id));

        for (const attr of LOCAL_REF_ATTRS) {
            const v = getAttr(out, attr);
            // Only a reference that resolves inside this module is repointed.
            // A dangling one is reported by planFixIds and left alone.
            if (v && bareIds.has(stripPrefix(v))) out = setAttr(out, attr, applyPrefix(mod.prefix, v));
        }
        return out;
    });
}

module.exports = { planFixIds, rewriteModule, prefixFor, stripPrefix, applyPrefix, scanModule, rewriteTags };
