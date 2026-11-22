import type { PublicationSettings } from '../studio/export/pdf-settings';

/** Map the project's publication fields onto what the Studio's PDF engine prints. */
export function toPublicationSettings(project: any, house: any): Partial<PublicationSettings> {
  const pub = project?.publication ?? {};
  const publisher = (project?.branding?.publishers ?? house?.branding?.publishers ?? [])[0]?.name ?? '';
  return {
    title: pub.bookName || project?.name || '',
    shortTitle: pub.systemName || '',
    pmCode: pub.publicationNo || '',
    publisher,
    classification: /^\d{2}$/.test(pub.securityClassification ?? '') ? '' : (pub.securityClassification ?? ''),
    watermark: 'auto',
    watermarkText: project?.watermark?.enabled && project.watermark.text ? project.watermark.text : 'NOT RELEASED',
  };
}

