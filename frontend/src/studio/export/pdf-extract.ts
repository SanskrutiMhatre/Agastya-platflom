/**
 * First half of the PDF export (runs on the page, it needs the XML DOM): reads the data modules and renders their
 * content to pdfmake nodes. The result, `PublicationInput`, is plain data; `pdf-assemble.ts` does the rest.
 *
 * It is cheap next to the layout (about 6 ms per data module), which is why only the layout moves to a worker.
 */
import type { EditorDocument } from '../core/document';
import { SECURITY_LABELS, type DmIdentInfo } from '../core/s1000d';
import { dmApplicText } from './pdf-applic';
import { buildRepository, type Repository } from './pdf-attention';
import { buildDmContext, footnoteNodes, referencesOf, renderDmBody, type ResolvedImage } from './pdf-content';
import { findUnsupportedChars } from './fonts';
import { DEFAULT_SETTINGS, type PublicationSettings } from './pdf-settings';
import type { DmInput, ImageResolver, PdfBuildOptions, PublicationInput } from './pdf-input';

function pad2(v: string): string {
  return v.length === 1 ? '0' + v : v;
}

function isoDate(ident: DmIdentInfo | null): string {
  if (!ident?.issueDate) return '';
  const [y, m, d] = ident.issueDate.split('-');
  return `${y}-${pad2(m ?? '')}-${pad2(d ?? '')}`;
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error('Could not read image data'));
    reader.readAsDataURL(blob);
  });
}

async function resolveImages(doc: EditorDocument, images: ImageResolver, warnings: Set<string>): Promise<Map<string, ResolvedImage>> {
  const icns = new Set<string>();
  for (const el of Array.from(doc.xml.getElementsByTagName('*'))) {
    const v = el.getAttribute('infoEntityIdent');
    if (v) icns.add(v);
  }
  const out = new Map<string, ResolvedImage>();
  await Promise.all(
    [...icns].map(async (icn) => {
      const blob = images.blob(icn);
      if (!blob) {
        warnings.add(`Graphic "${icn}" has no linked image file and was printed as a placeholder.`);
        return;
      }
      try {
        if (blob.type === 'image/svg+xml' || /\.svg$/i.test(icn)) {
          out.set(icn, { kind: 'svg', data: await blob.text() });
        } else {
          const data = await blobToDataUrl(blob);
          if (!/^data:image\/(png|jpe?g);/i.test(data)) {
            warnings.add(`Graphic "${icn}" is not a PNG, JPEG or SVG image and was printed as a placeholder.`);
            return;
          }
          out.set(icn, { kind: 'raster', data });
        }
      } catch {
        warnings.add(`Graphic "${icn}" could not be read and was printed as a placeholder.`);
      }
    }),
  );
  return out;
}

function extractDm(doc: EditorDocument, index: number, images: Map<string, ResolvedImage>, warnings: Set<string>, repo: Repository): DmInput {
  const ident = doc.ident;
  const root = doc.xml.documentElement;
  const cx = buildDmContext(doc.xml, doc.grammar, images, `dm${index}:`, warnings, false, repo);
  const body = renderDmBody(root, cx);
  const techName = ident?.techName || doc.fileName;
  const infoName = ident?.infoName ?? '';
  const sec = ident?.security ? SECURITY_LABELS[ident.security] ?? '' : '';
  return {
    index, id: `dm${index}`, dmc: (ident?.dmc ?? doc.fileName).replace(/^DMC-/i, ''), mic: ident?.parts?.modelIdentCode ?? '', techName, infoName,
    title: [techName, infoName].filter(Boolean).join(' – '),
    date: isoDate(ident), issueNumber: ident?.issueNumber ?? '', classification: sec.toUpperCase(),
    notReleased: !!ident && (ident.issueNumber === '000' || (ident.inWork !== '' && ident.inWork !== '00')),
    applic: dmApplicText(doc.xml),
    refs: referencesOf(root),
    collected: cx.collected,
    body,
    footnotes: footnoteNodes(cx),
  };
}

/** Reads the data modules (in order) into the data the assembly needs. */
export async function extractPublication(docs: EditorDocument[], images: ImageResolver, opts: Pick<PdfBuildOptions, 'mode' | 'settings'> = {}): Promise<PublicationInput> {
  if (!docs.length) throw new Error('No data modules to export');
  const warnings = new Set<string>();
  const settings: PublicationSettings = { ...DEFAULT_SETTINGS, ...opts.settings };
  const imgs = await Promise.all(docs.map((d) => resolveImages(d, images, warnings)));
  const repo = buildRepository(docs.map((d) => d.xml));
  const dms = docs.map((d, i) => {
    for (const ch of findUnsupportedChars(d.xml.documentElement)) warnings.add(`The character "${ch}" is not supported by the PDF export font and will be omitted.`);
    return extractDm(d, i, imgs[i], warnings, repo);
  });
  return { dms, settings, mode: opts.mode ?? 'publication', warnings: [...warnings] };
}
