/**
 * Presentation classification of S1000D elements, shared by the whitespace
 * normaliser, the XML pretty-printer and the WYSIWYG renderer.
 */
import type { Grammar } from './grammar';

export type Display = 'block' | 'inline' | 'atomic' | 'none' | 'table-part';

/** Elements that are always laid out as blocks. */
export const BLOCK = new Set<string>([
  // structure
  'dmodule', 'identAndStatusSection', 'dmAddress', 'dmIdent', 'dmAddressItems', 'dmStatus', 'dmTitle', 'content',
  'description', 'procedure', 'faultIsolation', 'faultReporting', 'crew', 'illustratedPartsCatalog', 'brex', 'comment',
  'commentContent', 'checkList', 'learning', 'process', 'schedul', 'wiringData', 'container', 'frontMatter', 'refs',
  'referencedApplicGroup', 'warningsAndCautions', 'commonInfo', 'commonInfoDescrPara', 'responsiblePartnerCompany',
  'originator', 'applic', 'brexDmRef', 'qualityAssurance', 'reasonForUpdate', 'remarks', 'security', 'techName', 'infoName',
  'issueDate', 'language', 'issueInfo', 'dmCode', 'skillLevel', 'productSafety', 'applicCrossRefTableRef', 'dataRestrictions',
  // text blocks
  'para', 'simplePara', 'title', 'levelledPara', 'levelledParaAlts', 'notePara', 'warningAndCautionPara', 'attentionListItemPara',
  'warning', 'caution', 'note', 'captionGroup', 'caption', 'legend', 'footnoteRemarks', 'displayText',
  // lists
  'randomList', 'sequentialList', 'listItem', 'definitionList', 'definitionListItem', 'definitionListHeader', 'listItemTerm',
  'listItemDefinition', 'attentionRandomList', 'attentionSequentialList', 'attentionRandomListItem', 'attentionSequentialListItem',
  'termTitle', 'definitionTitle',
  // figures / tables
  'figure', 'figureAlts', 'graphic', 'multimedia', 'multimediaObject', 'table', 'tgroup', 'thead', 'tbody', 'tfoot', 'row', 'entry',
  'colspec', 'spanspec', 'hotspot',
  // procedures
  'preliminaryRqmts', 'mainProcedure', 'closeRqmts', 'proceduralStep', 'proceduralStepAlts', 'reqCondGroup', 'reqCondNoRef',
  'reqCondDm', 'reqCondPm', 'reqCondExternalPub', 'reqCondCircuitBreaker', 'reqPersons', 'person', 'personnel', 'reqTechInfoGroup',
  'reqSupportEquips', 'reqSupplies', 'reqSpares', 'reqSafety', 'safetyRqmts', 'supportEquipDescrGroup', 'supportEquipDescr',
  'supplyDescrGroup', 'supplyDescr', 'spareDescrGroup', 'spareDescr', 'noConds', 'noSupportEquips', 'noSupplies', 'noSpares',
  'noSafety', 'reqCond', 'estimatedTime', 'reqQuantity', 'personCategory', 'personSkill', 'trade', 'reqTechInfo',
  'isolationProcedure', 'isolationStep', 'isolationMainProcedure', 'isolationProcedureEnd', 'action', 'isolationStepQuestion',
  'isolationStepAnswer', 'yesNoAnswer', 'yesAnswer', 'noAnswer', 'listOfChoices', 'choice', 'faultDescr', 'descr', 'fault',
  'detectionInfo', 'isolateDetectedFault', 'locateAndRepair', 'locateAndRepairLruItem', 'crewRefCard', 'crewDrill', 'crewDrillStep',
  'challengeAndResponse', 'challenge', 'response', 'case', 'caseCond', 'if', 'elseIf',
  // brex
  'contextRules', 'structureObjectRuleGroup', 'structureObjectRule', 'objectPath', 'objectUse', 'objectValue', 'snsRules',
  'notationRuleList', 'notationRule', 'nonContextRules', 'nonContextRule', 'brDecisionRef', 'brexDmRef',
  // ipd
  'catalogSeqNumber', 'itemSeqNumber', 'figureRef',
  // comment
  'commentAddress', 'commentAddressItems', 'commentStatus', 'commentIdent', 'commentTitle', 'commentRefs', 'commentResponse',
  'attachmentRef',
]);

/** Elements rendered as non-editable chips (edited through dialogs / attributes). */
export const ATOMIC = new Set<string>([
  'dmRef', 'pmRef', 'internalRef', 'dmCode', 'issueInfo', 'language', 'issueDate', 'security', 'footnoteRef', 'commentRef',
  'dmlRef', 'infoEntityRef', 'firstVerification', 'secondVerification', 'unverified', 'brexDmRef', 'applicRef', 'sourceDmIdent',
  'repositorySourceDmIdent', 'externalPubCode', 'catalogSeqNumberRef', 'pmCode', 'indexFlag',
  'noConds', 'noSupportEquips', 'noSupplies', 'noSpares', 'noSafety', 'skillLevel', 'symbol',
]);

/** Block-level objects rendered as non-editable boxes (selected and edited as a whole). */
export const ATOMIC_BLOCK = new Set<string>(['graphic', 'multimediaObject', 'hotspot']);

/**
 * Elements that are always inline, even though their own content model is
 * element-only. `acronym` is itself an inline element within running text, but its
 * content model is `acronymTerm, acronymDefinition` (element-only) — without this
 * override those two children would render as block `<div>`s nested inside the
 * `acronym` `<span>`, forcing the acronym onto its own line.
 * `elementDisplay` additionally applies the general rule "an element-only child of an
 * inline element is inline" (externalPubRef/externalPubRefIdent/externalPubTitle...),
 * so this list only needs names whose parent is not itself inline.
 */
export const FORCE_INLINE = new Set<string>(['acronymTerm', 'acronymDefinition']);

/** Elements whose content is whitespace-preserving. */
export const PRESERVE = new Set<string>(['verbatimText']);

/** Never rendered in the design view (still visible in XML view / tree). */
export const HIDDEN = new Set<string>(['colspec', 'spanspec', 'rdf:Description']);

/**
 * Elements that are normally inline but carry block-level elements inside
 * mixed content; treated as blocks so lists inside paragraphs lay out correctly.
 */
export function isBlockName(name: string): boolean {
  return BLOCK.has(name);
}

export function elementDisplay(el: Element, grammar: Grammar | null): Display {
  const name = el.nodeName;
  if (HIDDEN.has(name)) return 'none';
  if (ATOMIC.has(name)) {
    // atomic chips live inline unless their parent is element-only
    return 'atomic';
  }
  if (BLOCK.has(name)) return 'block';
  if (FORCE_INLINE.has(name)) return 'inline';
  const parent = el.parentNode as Element | null;
  if (parent && parent.nodeType === 1) {
    if (grammar?.has(parent.nodeName)) {
      if (grammar.allowsText(parent.nodeName)) return 'inline';
      // children of an element-only element that is itself inline (acronym, externalPubRef, ...) stay on the line
      return elementDisplay(parent, grammar) === 'inline' ? 'inline' : 'block';
    }
    // unknown parent: inline if parent has real text
    for (const c of Array.from(parent.childNodes)) if (c.nodeType === 3 && /\S/.test(c.nodeValue || '')) return 'inline';
    return 'block';
  }
  return 'block';
}

/** Whether an element's content is element-only (whitespace insignificant). */
export function isElementOnly(el: Element, grammar: Grammar | null): boolean {
  const name = el.nodeName;
  if (PRESERVE.has(name) || el.getAttribute('xml:space') === 'preserve') return false;
  if (grammar && grammar.has(name)) return !grammar.allowsText(name);
  for (const c of Array.from(el.childNodes)) {
    if ((c.nodeType === 3 && /\S/.test(c.nodeValue || '')) || c.nodeType === 4) return false;
    // without a schema, an element that holds inline elements ("<emphasis>a</emphasis> <emphasis>b</emphasis>") is mixed content:
    // the space between them is text and must survive
    if (c.nodeType === 1 && !BLOCK.has(c.nodeName)) return false;
  }
  return true;
}

export function isPreserved(el: Element): boolean {
  for (let n: Node | null = el; n && n.nodeType === 1; n = n.parentNode) {
    const e = n as Element;
    if (PRESERVE.has(e.nodeName)) return true;
    const sp = e.getAttribute('xml:space');
    if (sp === 'preserve') return true;
    if (sp === 'default') return false;
  }
  return false;
}
