// Public surface of the package importer (pure stages: scan + repair; the HTTP/apply side is routes/importer.ts).
export { scanPackage, analyzePackage, type Analysis } from './scanner';
export { repairPackage, repairedEntries, RULES, defaultRules, normaliseRules, reconstructedKind } from './repair';
export { loadPackage, expandZips, type Package, type PkgFile, type DmRec, type PmcRec } from './package';
export { readZip, isZip, ZipError } from './zipRead';
export { placeholderPng, pngInfo, isPlaceholderPng, encodePng } from './png';
export { detectFlavour } from './flavour';
export { assembleStructure, findAnchors } from './structure';
export { recoverStructureFromPdf, inventoryFromEntries, hintsFromEntries, publicationsFromRows, extractTocRows, type RecoveredStructure, type RecoveredPublication } from './recover/pdfToc';
export * from './types';
