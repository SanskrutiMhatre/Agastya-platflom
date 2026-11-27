// Document profiles: what a new project starts with when it is meant to become a particular
// JSS document. A profile is only a starting point - a house template and a chapter outline.
// Projects created without one are untouched, and every S1000D rule still applies to the
// data modules, whichever profile the project began with.

import { escText as esc } from '../lib/xml';
export interface Profile {
  id: string;
  label: string;
  /** House template (workspace/templates/<id>.house.json) the project starts on. */
  templateRef: string;
  /** Chapter titles, in book order, written into the new publication module. */
  chapters: string[];
  /** Engine the project builds with. Omitted = the JSS book pipeline, which is what every profile used before this field existed. */
  pipeline?: 's1000dtofo' | 's1000dtojss';
}

const UHB_CHAPTERS = [
  'Leading Particulars and General Data',
  'Brief Technical Description',
  'Unpacking and Removal of Preservatives',
  'Preparation for Use and Installation Specification',
  'Operating Instructions',
  "User's Servicing and Maintenance Instructions",
  'Miscellaneous',
];

export const PROFILES: Profile[] = [
  {
    id: 'uhb',
    label: 'User Handbook',
    templateRef: 'uhb',
    chapters: UHB_CHAPTERS,
  },
  {
    // The same handbook with the page furniture of the Xignal JSS-0251 reference (templates/xignal-jss.house.json says what was and was not measured).
    id: 'xignal-jss',
    label: 'User Handbook (Xignal JSS layout)',
    templateRef: 'xignal-jss',
    chapters: UHB_CHAPTERS,
  },
  {
    // The S1000D publication as Xignal / Docuneering print it: one data module per page group, mirrored margins,
    // logo + classification head, DMC/date/page foot and rotated margin marks. Structure comes from an imported
    // PMC (or the importer's reconstruction), so there are no starter chapters.
    id: 'xignal-s1000d',
    label: 'S1000D publication (Xignal layout)',
    templateRef: 'xignal-s1000d',
    pipeline: 's1000dtofo',
    chapters: [],
  },
];

export const profileById = (id: unknown): Profile | undefined => PROFILES.find((p) => p.id === id);


/** The `<pmEntry>` blocks for a profile's chapters, ready to sit inside `<content>`. */
export function chapterEntries(profile: Profile): string {
  return profile.chapters.map((t) => `    <pmEntry>\n      <pmEntryTitle>${esc(t)}</pmEntryTitle>\n    </pmEntry>`).join('\n');
}
