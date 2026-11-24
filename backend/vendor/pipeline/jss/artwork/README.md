# JSS default artwork

Pictures taken unchanged from the JSS-0251 stencils (`manual format/JSS0251-stencils/UHB.docx`, `word/media`), used when a JSS project has not supplied its own
(or names a file that is not in its `Media` folder):

| File | In the stencil | Used for |
|---|---|---|
| emblem.png | image1 (135 x 180) | the emblem on the title pages |
| lt-logo.png | image2 (1255 x 232) | the publisher logo of Larsen & Toubro |
| first-aid.png | image3..6 stacked top to bottom, 10 px apart | the four figures beside the first-aid steps |

The pictures belong to the customer who supplied the stencils (and the logo to its owner); they are shipped as defaults only, never written into a project.
A project's own file always wins. See `applyDefaultArtwork()` in `backend/src/services/publisher.ts`.
