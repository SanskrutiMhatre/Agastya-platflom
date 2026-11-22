/**
 * Publication settings of the PDF export. Kept in a module of its own (no pdfmake, no layout code) so the UI can
 * persist and edit them without pulling the lazily loaded export engine into the main bundle.
 */

export interface PublicationSettings {
  title: string;
  shortTitle: string;
  /** Publication module code line, e.g. "GNT-1671Y-00006-01"; omitted when empty. */
  pmCode: string;
  /** Publication issue number, e.g. "000". */
  issueNumber: string;
  issueDate: string;
  publisher: string;
  /** Classification printed in header/footer; empty = taken from each data module's security classification. */
  classification: string;
  /** Right-hand header text; empty = "<model identification code> PUBLICATION" of each data module. */
  headerText: string;
  /** Header logo / cover image as data URLs. */
  logo: string | null;
  cover: string | null;
  /** Diagonal watermark: 'auto' prints it on data modules that are not yet released (issue 000 or in work). */
  watermark: 'auto' | 'on' | 'off';
  watermarkText: string;
}

export const DEFAULT_SETTINGS: PublicationSettings = {
  title: '', shortTitle: '', pmCode: '', issueNumber: '', issueDate: '', publisher: '', classification: '', headerText: '', logo: null, cover: null,
  watermark: 'auto', watermarkText: 'NOT RELEASED',
};
