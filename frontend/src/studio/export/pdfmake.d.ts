/**
 * pdfmake ships no type declarations for its browser bundle or its font
 * container modules (plain data files, see `fonts.ts`). We deliberately keep
 * our own interaction with the library narrow and typed (`PdfMakeLike` in
 * `fonts.ts`); these modules are only ever imported dynamically and cast to
 * that interface, so `any` here is fully contained.
 */
/** The unminified browser bundle as a string (`?raw`): `pdfmake-patch.ts` patches and evaluates it. */
declare module 'pdfmake/build/pdfmake.js?raw' {
  const source: string;
  export default source;
}
declare module 'pdfmake/build/fonts/Roboto.js' {
  const fontContainer: unknown;
  export default fontContainer;
}
declare module 'pdfmake/build/standard-fonts/Courier.js' {
  const fontContainer: unknown;
  export default fontContainer;
}
declare module 'pdfmake/build/standard-fonts/Helvetica.js' {
  const fontContainer: unknown;
  export default fontContainer;
}
