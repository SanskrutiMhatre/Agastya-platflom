'use strict';
/*
  Review comments: who may write them, and where a comment actually points.

  Two things live here because both are easy to get subtly wrong in a route
  handler, and both are worth being able to read in one place.

  WHO. Not a rank check. Roles rank viewer < reviewer < editor < owner, but the
  people who comment are owners, reviewers and software administrators —
  editors are deliberately not among them. An editor's job is to change the
  module; a reviewer's is to say what needs changing. So this cannot be
  expressed as "reviewer and above", and writing it as one would silently let
  every editor comment.

  WHERE. A comment records the line it was made on AND the text of that line.
  Line numbers move as soon as anyone inserts a paragraph above, and a review
  note that quietly points at the wrong line is worse than no note at all — the
  reader acts on it. So the line is re-found by its text, and when it genuinely
  cannot be found the comment says so rather than pointing anywhere.
*/

// Project roles that may create, resolve and reopen comments.
const COMMENTING_ROLES = new Set(['owner', 'reviewer']);

/*
  `user` is the authenticated user; `role` their role on THIS project.
  A software administrator may comment on any project — they are the people
  asked to look at a publication they do not own.
*/
function canComment(user, role) {
    if (!user) return false;
    if (user.role === 'admin') return true;
    return COMMENTING_ROLES.has(String(role || ''));
}

// Deleting is narrower than commenting: your own, or a project owner's call.
function canDelete(user, role, comment) {
    if (!user || !comment) return false;
    if (comment.created_by === user.id) return true;
    if (user.role === 'admin') return true;
    return String(role || '') === 'owner';
}

const MAX_BODY = 4000;

function validateBody(body) {
    const text = String(body == null ? '' : body).trim();
    if (!text) return { ok: false, error: 'A comment cannot be empty.' };
    if (text.length > MAX_BODY) return { ok: false, error: `A comment is limited to ${MAX_BODY} characters.` };
    return { ok: true, text };
}

/*
  Where a comment sits in the document as it stands NOW.

  Returns { line, status } where status is:
    'exact'    the recorded line still holds the recorded text
    'moved'    the text was found on a different line; the comment follows it
    'detached' the text is gone — the comment keeps its original line for
               reference but must not be presented as pointing at it

  The search widens from the recorded line outwards, so an insertion of ten
  lines above finds the line ten below rather than some identical line at the
  other end of the file. Blank and near-blank anchors are not searched for at
  all: matching "  </para>" would find the wrong one every time.
*/
function locate(comment, text) {
    const line = comment.line == null ? null : Number(comment.line);
    const anchor = (comment.anchor_text == null ? '' : String(comment.anchor_text)).trim();
    if (line == null) return { line: null, status: 'exact' };      // whole-document comment
    const lines = String(text == null ? '' : text).split('\n');

    const at = (n) => (n >= 1 && n <= lines.length ? lines[n - 1].trim() : null);
    if (!anchor) return { line, status: at(line) == null ? 'detached' : 'exact' };
    if (at(line) === anchor) return { line, status: 'exact' };

    // Too short or too common to identify anything on its own.
    if (anchor.length < 8) return { line, status: at(line) == null ? 'detached' : 'exact' };

    for (let d = 1; d <= lines.length; d++) {
        if (at(line - d) === anchor) return { line: line - d, status: 'moved' };
        if (at(line + d) === anchor) return { line: line + d, status: 'moved' };
        if (line - d < 1 && line + d > lines.length) break;
    }
    return { line, status: 'detached' };
}

// The line's text as it stands, for storing with a new comment.
function anchorFor(text, line) {
    if (line == null) return null;
    const lines = String(text == null ? '' : text).split('\n');
    const raw = lines[Number(line) - 1];
    return raw == null ? null : raw.trim().slice(0, 400);
}

module.exports = { canComment, canDelete, validateBody, locate, anchorFor, COMMENTING_ROLES, MAX_BODY };
