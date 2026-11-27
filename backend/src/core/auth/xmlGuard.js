'use strict';
// Write-time XML safety guard (XXE, XInclude file disclosure, entity expansion).
//
// Applied wherever XML content enters the workspace: the editor save routes of all three formats (S1000D data modules,
// JSS books and ancillary pages, JSG documents), batch uploads, package and archive import. The build pipeline runs
// xsltproc with --nonet (remote fetches off) but with entity substitution, DTD loading, DTD default attributes and
// --xinclude on, so the dangerous constructs are LOCAL ones: a parsed external entity or an xi:include that copies a
// file of this machine into the built document, and entity nesting that expands a document without limit.
//
// S1000D content legitimately declares unparsed NDATA entities for graphics ("ICN-....png") and references public DTDs
// and the ISO character entity sets by http URL, so the guard distinguishes rather than banning DOCTYPE outright:
//
//   allowed  <!ENTITY ICN-X SYSTEM "icn-x.png" NDATA png>              (unparsed, relative)
//   allowed  <!DOCTYPE dmodule SYSTEM "http://www.s1000d.org/...">      (--nonet never fetches it)
//   allowed  <!DOCTYPE x SYSTEM "local.dtd">                           (relative, stays in the project)
//   allowed  <!ENTITY % ISOEntities PUBLIC "..." "http://www.s1000d.org/..."> %ISOEntities;
//   allowed  <!ENTITY company "Acme Ltd">                              (plain internal text)
//   allowed  <xi:include href="part.xml"/>                             (relative, inside the project)
//   refused  <!ENTITY x SYSTEM "file:///etc/passwd">                   (parsed external entity: XXE)
//   refused  <!ENTITY % p SYSTEM "file:///etc/passwd">                 (local read)
//   refused  <!ENTITY % p "replacement text">                          (internal parameter entity: expansion)
//   refused  <!ENTITY a "&b;&b;"> / <!ENTITY a "<x/>">                 (nesting or markup in an internal entity)
//   refused  <xi:include href="file:///C:/Windows/win.ini" parse="text"/>, href="../../x", href="C:\x"
//   refused  any SYSTEM/PUBLIC identifier with '..', an absolute path, a drive letter, a backslash or a non-http(s) scheme
//   refused  more than one DOCTYPE, a DOCTYPE hidden behind a comment or PI (the decoy of SEC-001), conditional
//            sections in the internal subset, an encoding other than UTF-8 / ASCII / Latin-1, NUL characters
//   refused  more than MAX_ENTITY_DECLS entity declarations
//
// The scanner is a tokenizer, not a regular expression over the whole text: comments, processing instructions and
// quoted literals are skipped as units, so text that merely LOOKS like a declaration inside them is never mistaken for
// one, and a real declaration can never hide inside something the scanner skipped. Character references are decoded
// before namespace and identifier checks, so "&#x66;ile:" is "file:".

const MAX_ENTITY_DECLS = 500;
// S1K-005: a second bound on the text internal entities stand for. Internal entities cannot nest (checkEntity), so a
// document expands to at most its own size plus, for every reference, the length of that entity's text.
const MAX_ENTITY_TEXT = 64 * 1024;            // all internal entity values together
const MAX_ENTITY_EXPANSION = 8 * 1024 * 1024; // the extra text all references in the document add up to
const XINCLUDE_NS = /^http:\/\/www\.w3\.org\/(2001|2003)\/XInclude$/;
// ASCII-compatible encodings only: in them every markup character is the byte the scanner sees. UTF-16/32, UTF-7 and
// EBCDIC could carry markup the scanner cannot see.
const SAFE_ENCODINGS = /^(utf-?8|us-ascii|ascii|iso-?8859-([1-9]|1[0-6])|iso_8859-([1-9]|1[0-6])|latin-?[1-9]|windows-125[0-8]|cp125[0-8])$/i;

const refuse = (error) => ({ ok: false, error: `XML refused: ${error}` });

// A SYSTEM/PUBLIC identifier or xi:include href that is safe to keep: a relative path that cannot leave the project
// directory and is not a URL (http(s) allowed for DTD identifiers only, never fetched thanks to --nonet).
function safeIdentifier(id, { allowHttp }) {
  const s = decodeCharRefs(String(id || '')).trim();
  if (!s) return true;
  if (/^https?:\/\//i.test(s)) return !!allowHttp;
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(s)) return false; // any other scheme (file:, php:, jar:, ...) and a drive letter
  if (s.includes('\\') || s.includes('\0')) return false;
  if (s.startsWith('/') || s.startsWith('~')) return false;
  if (s.split('/').some((seg) => seg === '..' || /%2e%2e/i.test(seg))) return false;
  return true;
}

/** Decode numeric character references (and the five predefined entities) the way the XML parser will. */
function decodeCharRefs(s) {
  return String(s).replace(/&#x([0-9a-fA-F]+);|&#([0-9]+);|&(amp|lt|gt|quot|apos);/g, (m, hex, dec, named) => {
    if (named) return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[named];
    const cp = hex ? parseInt(hex, 16) : parseInt(dec, 10);
    try { return String.fromCodePoint(cp); } catch { return '\uFFFD'; }
  });
}

/** Index just past a quoted literal starting at text[i] (a quote), or -1 when it never closes. */
function skipQuoted(text, i) {
  const q = text[i]; const end = text.indexOf(q, i + 1);
  return end === -1 ? -1 : end + 1;
}

/**
 * Tokenize the prolog: XML declaration, comments, PIs, whitespace and at most one DOCTYPE, up to the first element.
 * Returns { doctype: { start, end, name, external, subset } | null, rootAt } or { error }.
 */
function scanProlog(text) {
  let i = 0; let doctype = null;
  if (text.charCodeAt(0) === 0xfeff) i = 1;
  while (i < text.length) {
    const c = text[i];
    if (c === ' ' || c === '\t' || c === '\r' || c === '\n') { i++; continue; }
    if (c !== '<') {
      // Text before the root element is not well-formed XML; the parser will refuse it. Nothing more to judge here.
      return { doctype, rootAt: i };
    }
    if (text.startsWith('<?', i)) { const e = text.indexOf('?>', i + 2); if (e === -1) return { error: 'an unterminated processing instruction.' }; i = e + 2; continue; }
    if (text.startsWith('<!--', i)) { const e = text.indexOf('-->', i + 4); if (e === -1) return { error: 'an unterminated comment.' }; i = e + 3; continue; }
    if (text.startsWith('<!DOCTYPE', i) || /^<!doctype/i.test(text.slice(i, i + 9))) {
      if (doctype) return { error: 'more than one DOCTYPE declaration.' };
      const d = scanDoctype(text, i);
      if (d.error) return d;
      doctype = d; i = d.end; continue;
    }
    if (text.startsWith('<!', i)) return { error: 'an unexpected declaration before the root element.' };
    return { doctype, rootAt: i };   // the root element starts here
  }
  return { doctype, rootAt: text.length };
}

/** A DOCTYPE starting at text[at]: its name, external identifier literals and internal subset, quote- and comment-aware. */
function scanDoctype(text, at) {
  let i = at + 9;
  const literals = []; let subset = null; let subsetStart = -1;
  while (i < text.length) {
    const c = text[i];
    if (c === '"' || c === "'") {
      const e = skipQuoted(text, i); if (e === -1) return { error: 'an unterminated literal in the DOCTYPE.' };
      literals.push(text.slice(i + 1, e - 1)); i = e; continue;
    }
    if (c === '[') {
      subsetStart = i + 1;
      const s = scanSubsetEnd(text, subsetStart); if (s.error) return s;
      subset = text.slice(subsetStart, s.end); i = s.end + 1; continue;
    }
    if (c === '>') return { start: at, end: i + 1, externalIds: literals, subset, subsetStart };
    i++;
  }
  return { error: 'an unterminated DOCTYPE declaration.' };
}

/** The index of the ']' that closes the internal subset that starts at text[i], skipping literals, comments and PIs. */
function scanSubsetEnd(text, i) {
  while (i < text.length) {
    if (text.startsWith('<!--', i)) { const e = text.indexOf('-->', i + 4); if (e === -1) return { error: 'an unterminated comment in the DOCTYPE.' }; i = e + 3; continue; }
    if (text.startsWith('<?', i)) { const e = text.indexOf('?>', i + 2); if (e === -1) return { error: 'an unterminated processing instruction in the DOCTYPE.' }; i = e + 2; continue; }
    const c = text[i];
    if (c === '"' || c === "'") { const e = skipQuoted(text, i); if (e === -1) return { error: 'an unterminated literal in the DOCTYPE.' }; i = e; continue; }
    if (c === ']') return { end: i };
    i++;
  }
  return { error: 'an unterminated internal subset.' };
}

/**
 * The markup declarations of an internal subset, as tokens: { kind: 'ENTITY'|'ATTLIST'|'ELEMENT'|'NOTATION', body, literals }
 * and parameter-entity references { kind: 'PEREF', name }. Comments and PIs are skipped; anything else is an error.
 */
function declarations(subset) {
  const out = []; let i = 0;
  while (i < subset.length) {
    const c = subset[i];
    if (/\s/.test(c)) { i++; continue; }
    if (subset.startsWith('<!--', i)) { i = subset.indexOf('-->', i + 4) + 3; continue; }
    if (subset.startsWith('<?', i)) { i = subset.indexOf('?>', i + 2) + 2; continue; }
    if (c === '%') {
      const m = /^%([^\s;%<>"']+);/.exec(subset.slice(i));
      if (!m) return { error: 'a malformed parameter-entity reference in the DOCTYPE.' };
      out.push({ kind: 'PEREF', name: m[1] }); i += m[0].length; continue;
    }
    if (subset.startsWith('<![', i)) return { error: 'a conditional section in the internal subset.' };
    const m = /^<!(ENTITY|ATTLIST|ELEMENT|NOTATION)\b/.exec(subset.slice(i, i + 12));
    if (!m) return { error: `an unexpected token in the DOCTYPE ("${subset.slice(i, i + 20).replace(/\s+/g, ' ')}").` };
    let j = i + 2 + m[1].length; const literals = [];
    while (j < subset.length && subset[j] !== '>') {
      if (subset[j] === '"' || subset[j] === "'") { const e = skipQuoted(subset, j); literals.push(subset.slice(j + 1, e - 1)); j = e; continue; }
      j++;
    }
    if (j >= subset.length) return { error: `an unterminated <!${m[1]} declaration.` };
    out.push({ kind: m[1], body: subset.slice(i + 2 + m[1].length, j).trim(), literals });
    i = j + 1;
  }
  return { decls: out };
}

function checkEntity(d, state) {
  // <!ENTITY [%] name (literal | SYSTEM lit | PUBLIC lit lit) [NDATA n]>, with the literals already lifted out.
  const pe = /^%\s/.test(d.body);
  const rest = (pe ? d.body.slice(1) : d.body).trim();
  const nm = /^([^\s"']+)\s*([\s\S]*)$/.exec(rest);
  if (!nm) return 'a malformed entity declaration.';
  const name = nm[1]; const after = nm[2].replace(/(["'])[\s\S]*?\1/g, ' "" ').trim();
  if (++state.count > MAX_ENTITY_DECLS) return `more than ${MAX_ENTITY_DECLS} entity declarations.`;
  const external = /^(SYSTEM|PUBLIC)\b/.test(after);
  if (pe) {
    if (!external) return `parameter entity "${name}" carries its own replacement text, which can be used to expand a document without limit.`;
    for (const id of d.literals) if (!safeIdentifier(id, { allowHttp: true })) return `parameter entity "${name}" references an unsafe location ("${id}").`;
    state.externalPe.add(name);
    return null;
  }
  if (external) {
    if (!/\bNDATA\b/.test(after)) return `parsed external entity "${name}" (classic XXE). Only unparsed NDATA entities may reference files.`;
    for (const id of d.literals) if (!safeIdentifier(id, { allowHttp: false })) return `entity "${name}" references an unsafe location ("${id}").`;
    return null;
  }
  // Internal general entity: plain text only. A reference inside it (&x; or %x;) is the nesting of an expansion bomb,
  // markup inside it can smuggle elements (an xi:include) past every other check.
  // Character references are expanded when the entity is declared, the five predefined entities stay text.
  const value = d.literals[0] ?? '';
  const PREDEF = /&(amp|lt|gt|quot|apos);/g;
  const numericDecoded = value.replace(PREDEF, '').replace(/&#x([0-9a-fA-F]+);|&#([0-9]+);/g, (m, hex, dec) => { try { return String.fromCodePoint(hex ? parseInt(hex, 16) : parseInt(dec, 10)); } catch { return '�'; } });
  if (/[<&%]/.test(numericDecoded)) {
    return `entity "${name}" contains references or markup; only plain text is allowed in an internal entity.`;
  }
  if (/w3\.org\/(2001|2003)\/XInclude/.test(decodeCharRefs(value))) return `entity "${name}" names the XInclude namespace.`;
  state.text = (state.text || 0) + value.length;
  if (state.text > MAX_ENTITY_TEXT) return `the internal entities carry more than ${MAX_ENTITY_TEXT / 1024} KB of text.`;
  (state.internal || (state.internal = new Map())).set(name, value.length);
  return null;
}

/** Every xi:include / xi:fallback in the document (any prefix bound to the XInclude namespace, also by a DTD default). */
function checkXInclude(text) {
  const decoded = decodeCharRefs(text);
  // xml:base re-bases every relative reference below it (includes, graphics resolved by the stylesheets), so it may
  // never point outside the project, with or without XInclude.
  for (const m of decoded.matchAll(/\bxml:base\s*=\s*(["'])([\s\S]*?)\1/g)) {
    if (!safeIdentifier(m[2], { allowHttp: false })) return `xml:base pointing outside the project ("${m[2]}").`;
  }
  if (!/w3\.org\/(2001|2003)\/XInclude/.test(decoded)) return null;
  // Prefixes bound to the namespace, by attribute anywhere (elements or ATTLIST defaults).
  const prefixes = new Set(); let defaultNs = false;
  for (const m of decoded.matchAll(/xmlns(?::([^\s=:>"'/]+))?\s*(?:=\s*|CDATA\s+#FIXED\s+|CDATA\s+)(["'])([^"']*)\2/g)) {
    if (XINCLUDE_NS.test(m[3].trim())) { if (m[1]) prefixes.add(m[1]); else defaultNs = true; }
  }
  if (!prefixes.size && !defaultNs) return null;   // the address is only mentioned (in text); nothing is bound to it
  const names = [...prefixes].map((p) => p.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&') + ':');
  if (defaultNs) names.push('');
  const re = new RegExp(`<(?:${names.join('|')})(include|fallback)\\b([^>]*)>`, 'g');
  for (const m of decoded.matchAll(re)) {
    if (m[1] !== 'include') continue;
    const attrs = m[2];
    const href = /\bhref\s*=\s*(["'])([\s\S]*?)\1/.exec(attrs);
    if (href && !safeIdentifier(href[2], { allowHttp: false })) return `xi:include references an unsafe location ("${href[2]}"). Only a relative path inside the project is allowed.`;
    if (/\bxml:base\s*=/.test(attrs)) return 'xi:include with xml:base is not allowed.';
  }
  return null;
}

/**
 * An external DTD subset or entity set (.dtd, .ent): a document may pull it in with a relative SYSTEM identifier, so the
 * same file-disclosure rules apply to what it declares. Internal parameter entities and conditional sections are normal
 * in a DTD and are allowed here (libxml2 limits their expansion); parsed external entities and unsafe identifiers are not.
 */
function checkDtdSafety(text) {
  let body = text.replace(/^﻿/, '').replace(/^<\?xml\b[^?]*\?>/, '');
  // Conditional sections: keep their content (an IGNORE section is never read, but judging it costs nothing).
  body = body.replace(/<!\[\s*(INCLUDE|IGNORE|%[^;\s]+;)\s*\[/g, ' ').replace(/\]\]>/g, ' ');
  const d = declarations(body);
  if (d.error) return refuse(d.error.replace(' in the DOCTYPE', ' in the DTD'));
  const state = { count: 0, externalPe: new Set() };
  for (const t of d.decls) {
    if (t.kind !== 'ENTITY') continue;
    const pe = /^%\s/.test(t.body);
    if (pe) {
      const after = t.body.slice(1).trim().replace(/^[^\s"']+\s*/, '').replace(/(["'])[\s\S]*?\1/g, ' "" ').trim();
      if (/^(SYSTEM|PUBLIC)\b/.test(after)) for (const id of t.literals) if (!safeIdentifier(id, { allowHttp: true })) return refuse(`parameter entity references an unsafe location ("${id}").`);
      if (++state.count > MAX_ENTITY_DECLS * 20) return refuse('too many entity declarations.');
      continue;
    }
    const after = t.body.trim().replace(/^[^\s"']+\s*/, '').replace(/(["'])[\s\S]*?\1/g, ' "" ').trim();
    if (/^(SYSTEM|PUBLIC)\b/.test(after)) {
      if (!/\bNDATA\b/.test(after)) return refuse('a parsed external entity in a DTD (classic XXE). Only unparsed NDATA entities may reference files.');
      for (const id of t.literals) if (!safeIdentifier(id, { allowHttp: false })) return refuse(`entity references an unsafe location ("${id}").`);
    } else if (/w3\.org\/(2001|2003)\/XInclude/.test(decodeCharRefs(t.literals[0] ?? ''))) return refuse('an entity in a DTD names the XInclude namespace.');
    if (++state.count > MAX_ENTITY_DECLS * 20) return refuse('too many entity declarations.');
  }
  const xi = checkXInclude(text);
  return xi ? refuse(xi) : { ok: true };
}

/** Does the text start (after the XML declaration, comments and PIs) with a markup declaration, i.e. is it a DTD? */
function looksLikeDtd(text) {
  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  while (i < text.length) {
    const c = text[i];
    if (c === ' ' || c === '\t' || c === '\r' || c === '\n') { i++; continue; }
    if (text.startsWith('<?', i)) { const e = text.indexOf('?>', i + 2); if (e === -1) return false; i = e + 2; continue; }
    if (text.startsWith('<!--', i)) { const e = text.indexOf('-->', i + 4); if (e === -1) return false; i = e + 3; continue; }
    if (c === '%') return true;
    if (text.startsWith('<![', i)) return true;
    return /^<!(ENTITY|ELEMENT|ATTLIST|NOTATION)\b/.test(text.slice(i, i + 12));
  }
  return false;
}

function checkXmlSafety(content) {
  const text = String(content == null ? '' : content);
  if (text.includes('\0')) return refuse('the document contains NUL characters (it is probably not UTF-8: save it as UTF-8).');
  if (looksLikeDtd(text)) return checkDtdSafety(text);
  const decl = /^\uFEFF?<\?xml\b([^?]*)\?>/.exec(text);
  if (decl) {
    const enc = /\bencoding\s*=\s*(["'])([^"']*)\1/.exec(decl[1]);
    if (enc && !SAFE_ENCODINGS.test(enc[2].trim())) return refuse(`the encoding "${enc[2]}" is not supported here: save the document as UTF-8.`);
  }
  const p = scanProlog(text);
  if (p.error) return refuse(p.error);
  if (p.doctype) {
    for (const id of p.doctype.externalIds) if (!safeIdentifier(id, { allowHttp: true })) return refuse(`DOCTYPE references an unsafe location ("${id}").`);
    if (p.doctype.subset != null) {
      const d = declarations(p.doctype.subset);
      if (d.error) return refuse(d.error);
      const state = { count: 0, externalPe: new Set() };
      for (const t of d.decls) {
        if (t.kind === 'ENTITY') { const e = checkEntity(t, state); if (e) return refuse(e); }
        else if (t.kind === 'PEREF') { if (!state.externalPe.has(t.name)) return refuse(`parameter entity "%${t.name};" is used before it is declared as an external entity.`); }
        else if (t.kind === 'NOTATION' || t.kind === 'ATTLIST') {
          for (const id of t.literals) {
            if (t.kind === 'NOTATION' && !safeIdentifier(id, { allowHttp: true })) return refuse(`notation references an unsafe location ("${id}").`);
          }
        }
      }
      if (state.internal && state.internal.size) {
        let added = 0;
        for (const m of text.slice(p.rootAt).matchAll(/&([^\s;&#<>]+);/g)) {
          added += state.internal.get(m[1]) || 0;
          if (added > MAX_ENTITY_EXPANSION) return refuse(`the entity references would expand the document by more than ${MAX_ENTITY_EXPANSION / 1048576} MB.`);
        }
      }
    }
  }
  // No DOCTYPE may appear after the prolog either (the decoy can also follow a fake root in a fragment).
  const rest = text.slice(p.rootAt);
  if (/<!DOCTYPE/i.test(rest.replace(/<!--[\s\S]*?-->/g, '').replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, ''))) return refuse('a DOCTYPE declaration after the start of the document.');
  const xi = checkXInclude(text);
  if (xi) return refuse(xi);
  return { ok: true };
}

// Relative-path safety for anything user-supplied that will be joined onto a
// project directory. One rule for every route.
function safeRelPath(rel) {
  const s = String(rel || '').replace(/\\/g, '/');
  if (!s || s.length > 512) return null;
  if (s.startsWith('/') || /^[a-zA-Z]:/.test(s)) return null;
  if (s.split('/').some((seg) => seg === '..' || seg === '' || seg === '.')) return null;
  if (s.includes('\0')) return null;
  return s;
}

/**
 * An artwork reference (publisher logo, emblem) that a build may embed: a relative path inside the project, or a data:
 * image URI. Never a URL, an absolute or drive path, a UNC path or "..": FOP would fetch or read it (SEC-003).
 */
function safeArtworkRef(ref) {
  const s = String(ref == null ? '' : ref).trim();
  if (!s) return true;
  if (/^data:image\/(png|jpe?g|gif|svg\+xml);base64,[A-Za-z0-9+/=\s]+$/i.test(s)) return true;
  return safeIdentifier(s, { allowHttp: false }) && safeRelPath(s) !== null;
}

module.exports = { checkXmlSafety, safeRelPath, safeArtworkRef, safeIdentifier, decodeCharRefs, MAX_ENTITY_DECLS, MAX_ENTITY_TEXT, MAX_ENTITY_EXPANSION };
