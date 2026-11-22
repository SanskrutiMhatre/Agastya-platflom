// =============================================================================
// Which file formats an ICN / multimedia asset may have.
//
// SOURCE: S1000D Issue 4.2, Chap 7.3.3 "CSDB objects - Multimedia" tables 3-7 (audio, video, 3D, miscellaneous) and Chap 7.5.1 para 2.2
// (CGM, CG4, TIF, JPG, PNG, GIF, PDF + multimedia by extension). Later issues' lists are UNVERIFIED (their text is not available to this project).
// Formats the platform accepts beyond that list (svg, bmp, webp - already accepted by AGASTYA before this phase) are marked `platform`.
//
// Miscellaneous types that can carry active content (JS, CSS, DOC, XLS, PPT/PPS, MDB, MPP, ZIP, FLA) are in the specification table but are
// DISABLED unless an administrator enables them (config collection "asset-formats"): a script or a macro document is not an illustration,
// and storing it must be a deliberate choice. They are never executed or rendered by AGASTYA.
// =============================================================================

export type AssetClass = 'image' | 'audio' | 'video' | '3d' | 'document' | 'other';
export interface FormatInfo { ext: string; cls: AssetClass; source: 'spec-4.2' | 'platform'; risky: boolean; mime: string }

const row = (cls: AssetClass, source: FormatInfo['source'], mime: string, exts: string, risky = false): FormatInfo[] =>
  exts.split(/\s+/).filter(Boolean).map((e) => ({ ext: e.toLowerCase(), cls, source, risky, mime }));

export const FORMATS: FormatInfo[] = [
  ...row('image', 'spec-4.2', 'image/png', 'png'), ...row('image', 'spec-4.2', 'image/jpeg', 'jpg jpeg'), ...row('image', 'spec-4.2', 'image/gif', 'gif'),
  ...row('image', 'spec-4.2', 'image/tiff', 'tif tiff'), ...row('image', 'spec-4.2', 'image/cgm', 'cgm cg4'),
  ...row('image', 'platform', 'image/svg+xml', 'svg'), ...row('image', 'platform', 'image/bmp', 'bmp'), ...row('image', 'platform', 'image/webp', 'webp'),
  ...row('audio', 'spec-4.2', 'audio/x-aiff', 'aif aifc cdda'), ...row('audio', 'spec-4.2', 'audio/midi', 'mid midi rmi kar smf'), ...row('audio', 'spec-4.2', 'audio/x-mpegurl', 'pls m3u m3url'),
  ...row('audio', 'spec-4.2', 'audio/x-cda', 'cda'), ...row('audio', 'spec-4.2', 'audio/wav', 'wav'), ...row('audio', 'spec-4.2', 'audio/mpeg', 'mp3 swa'),
  ...row('audio', 'spec-4.2', 'audio/basic', 'au snd ulw'), ...row('audio', 'spec-4.2', 'audio/x-ms-wma', 'wma'),
  ...row('video', 'spec-4.2', 'video/x-fli', 'fli'), ...row('video', 'spec-4.2', 'video/x-dv', 'dif dv'), ...row('video', 'spec-4.2', 'video/x-msvideo', 'avi'),
  ...row('video', 'spec-4.2', 'video/mpeg', 'mp2 mp2v mp4 mpe mpeg mpg mlv mpg4'), ...row('video', 'spec-4.2', 'video/x-mheg', 'mheg'),
  ...row('video', 'spec-4.2', 'application/vnd.rn-realmedia', 'ra ram rm rmj'), ...row('video', 'spec-4.2', 'application/smil', 'smi sml'), ...row('video', 'spec-4.2', 'video/x-flv', 'flv'),
  ...row('video', 'spec-4.2', 'video/x-ms-asf', 'asf asr asx'), ...row('video', 'spec-4.2', 'video/quicktime', 'mov qt qtr qtx'), ...row('video', 'spec-4.2', 'video/x-ms-wmv', 'wm wmp wmv wmx'),
  ...row('video', 'platform', 'video/webm', 'webm'),
  ...row('3d', 'spec-4.2', 'model/iges', 'iges'), ...row('3d', 'spec-4.2', 'application/octet-stream', 'catdrawing catpart catproduct cgr ct model ds-3dxml ugs xv0 xv2 xv xvl asm drw ed edz frm prt rh sldasm slddrw sldprt step w3d dcr smg smgxml smggeom dwf'),
  ...row('3d', 'spec-4.2', 'model/u3d', 'u3d'), ...row('3d', 'spec-4.2', 'model/vrml', 'wrl'), ...row('3d', 'spec-4.2', 'model/x3d+xml', 'x3d'),
  ...row('document', 'spec-4.2', 'application/pdf', 'pdf'), ...row('document', 'spec-4.2', 'application/smil+xml', 'smil'),
  ...row('other', 'spec-4.2', 'text/css', 'css', true), ...row('other', 'spec-4.2', 'application/msword', 'doc', true), ...row('other', 'spec-4.2', 'application/x-shockwave-flash', 'fla', true),
  ...row('other', 'spec-4.2', 'text/javascript', 'js', true), ...row('other', 'spec-4.2', 'application/x-msaccess', 'mdb', true), ...row('other', 'spec-4.2', 'application/vnd.ms-project', 'mpp', true),
  ...row('other', 'spec-4.2', 'application/vnd.ms-powerpoint', 'pps ppt', true), ...row('other', 'spec-4.2', 'application/vnd.ms-excel', 'xls', true), ...row('other', 'spec-4.2', 'application/zip', 'zip', true),
];
const BY_EXT = new Map(FORMATS.map((f) => [f.ext, f]));

export const extOf = (name: string): string => { const m = /\.([A-Za-z0-9-]+)$/.exec(name); return m ? m[1].toLowerCase() : ''; };
export const formatOf = (name: string): FormatInfo | undefined => BY_EXT.get(extOf(name));

/** Is this file name an allowed asset? `allowRisky` is the administrator's opt-in for the active-content types. */
export function assetProblem(name: string, allowRisky: boolean): string | null {
  const f = formatOf(name);
  if (!f) return `.${extOf(name) || '(none)'} is not a supported illustration or multimedia format (see backend/src/services/mediaFormats.ts).`;
  if (f.risky && !allowRisky) return `.${f.ext} files can carry scripts or macros, so they are stored only when an administrator enables "risky multimedia types".`;
  return null;
}
